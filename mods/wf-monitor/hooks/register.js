// wf-monitor: dynamic workflow run'larını izler.
// Veri kaynakları:
//   - Workflow tool sonucu: taskId, workflowName, transcriptDir, scriptPath
//   - transcriptDir/agent-<id>.jsonl: başlayan agent'lar (mtime → aktif mi)
//   - transcriptDir/journal.jsonl: dönen agent sonuçları (satır sayısı → biten)
//   - workflow agent'larının tool.call event'leri (agentId): son adım
//   - Stop / SubagentStop hook'undaki background_tasks: run bitti mi
// Çıktılar:
//   - Terminal / Desktop: yan pane
//   - Her yerde (cloud dahil): /wf metin özeti
//   - WF_MONITOR_URL + WF_MONITOR_TOKEN tanımlıysa: durumu dashboard'a POST eder

const PANE_ID = 'wf-monitor'
const POLL_MS = 2000
const ACTIVE_MS = 20000
const HEARTBEAT_MS = 15000

const runs = new Map() // taskId -> run
const lastAction = new Map() // agentId -> metin
let host = null // session.start'ta kurulan, mods API çağrılarını saran fonksiyonlar
let drawing = false
let paneOpen = false
let stopPolling = null
let nowMs = 0
let lastKey = ''
let lastPushAt = 0

function short(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function describe(e) {
  switch (e.tool) {
    case 'Bash':
      return 'Bash: ' + short(e.command, 48)
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return e.tool + ' ' + short(String(e.file_path ?? '').split('/').pop(), 40)
    case 'Grep':
    case 'Glob':
      return e.tool + ' ' + short(e.pattern, 36)
    case 'WebFetch':
      try {
        return 'WebFetch ' + new URL(e.url).host
      } catch {
        return e.url ? 'WebFetch ' + short(e.url, 40) : 'WebFetch'
      }
    case 'WebSearch':
      return 'WebSearch: ' + short(e.query, 48)
    case 'Agent':
      return 'Agent: ' + short(e.description, 40)
    default:
      return String(e.tool)
  }
}

function since(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m ? `${m}dk ${s % 60}sn` : `${s}sn`
}

function phasesOf(source) {
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!meta) return []
  return [...meta[1].matchAll(/title:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1])
}

function hasRunning() {
  for (const r of runs.values()) if (r.status === 'running') return true
  return false
}

function redraw() {
  if (host && drawing && paneOpen) host.invalidate()
}

function view(r) {
  const end = r.endedAt ?? nowMs
  return {
    taskId: r.taskId,
    name: r.name,
    status: r.status,
    elapsedMs: Math.max(0, end - r.startedAt),
    phases: r.phases,
    done: r.done,
    lastLabel: r.lastLabel,
    agents: r.agents.map(a => ({
      id: a.id.slice(0, 8),
      active: end - a.mtime < ACTIVE_MS,
      last: lastAction.get(a.id) ?? null,
    })),
  }
}

async function push() {
  if (!host || !host.post || runs.size === 0) return
  const list = [...runs.values()].slice(-10).map(view)
  const key = JSON.stringify(list.map(({ elapsedMs, ...rest }) => rest))
  if (key === lastKey && nowMs - lastPushAt < HEARTBEAT_MS) return
  lastKey = key
  lastPushAt = nowMs
  await host.post({ session: host.session, runs: list }).catch(() => {})
}

function summaryText() {
  if (runs.size === 0) return 'Bu session\'da workflow çalışmadı.'
  const lines = []
  for (const r of runs.values()) {
    const v = view(r)
    const active = v.agents.filter(a => a.active)
    lines.push(
      `${v.name} · ${v.status} · ${since(v.elapsedMs)} · ` +
        `başlayan ${v.agents.length} / aktif ${active.length} / biten ${v.done}`,
    )
    if (v.phases.length) lines.push('  aşamalar: ' + v.phases.join(' → '))
    if (v.lastLabel) lines.push('  son dönen: ' + v.lastLabel)
    if (v.status === 'running') for (const a of active) lines.push(`  ${a.id}  ${a.last ?? '…'}`)
  }
  return lines.join('\n')
}

async function refresh(run) {
  if (!host || !run.transcriptDir) return
  let entries
  try {
    entries = await host.list(run.transcriptDir)
  } catch {
    return
  }
  const agents = []
  for (const ent of entries) {
    const m = /^agent-(.+)\.jsonl$/.exec(ent.name)
    if (!m || ent.kind !== 'file') continue
    let mtime = 0
    try {
      mtime = (await host.stat(`${run.transcriptDir}/${ent.name}`)).mtimeMs
    } catch {}
    agents.push({ id: m[1], mtime })
  }
  run.agents = agents
  if (entries.some(ent => ent.name === 'journal.jsonl')) {
    try {
      const rows = (await host.read(`${run.transcriptDir}/journal.jsonl`)).split('\n').filter(Boolean)
      run.done = rows.length
      try {
        const last = JSON.parse(rows[rows.length - 1])
        run.lastLabel = last.label ?? last.opts?.label ?? run.lastLabel
      } catch {}
    } catch {}
  }
}

async function finish(run, status) {
  if (!host || run.status !== 'running') return
  run.status = status
  run.endedAt = await host.now()
  nowMs = run.endedAt
  await refresh(run) // son durumu bir kez daha oku
  const msg = `workflow ${run.name}: ${status} (${since(run.endedAt - run.startedAt)}, ${run.done} agent sonucu)`
  if (drawing) host.toast(msg)
  host.log(msg)
  if (!hasRunning() && stopPolling) {
    stopPolling()
    stopPolling = null
  }
  redraw()
  await push()
}

async function poll() {
  if (!host) return
  nowMs = await host.now()
  for (const run of runs.values()) if (run.status === 'running') await refresh(run)
  redraw()
  await push()
}

function startPolling() {
  if (host && !stopPolling) stopPolling = host.every(POLL_MS, () => void poll().catch(() => {}))
}

async function openPane() {
  if (!host || !drawing) return
  paneOpen = true
  await host.open().catch(() => {})
}

async function reconcile(tasks) {
  if (!Array.isArray(tasks)) return
  for (const run of runs.values()) {
    if (run.status !== 'running') continue
    const t = tasks.find(x => x.id === run.taskId || (x.type === 'workflow' && x.name === run.name))
    // background_tasks yalnızca hâlâ süren işleri listeler: listede yoksa bitmiştir
    if (!t) await finish(run, 'bitti')
    else if (!['running', 'pending'].includes(t.status)) await finish(run, t.status)
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const url = await $.env.get('WF_MONITOR_URL')
    const token = await $.env.get('WF_MONITOR_TOKEN')
    const repo = await $.session.repo().catch(() => null)
    const id = await $.session.id()
    host = {
      now: () => $.clock.now(),
      every: (ms, fn) => $.clock.every(ms, fn),
      list: path => $.fs.list(path),
      stat: path => $.fs.stat(path),
      read: path => $.fs.read(path),
      invalidate: () => $.ui.invalidate('ui.render'),
      toast: text => $.ui.toast(text),
      log: text => $.ui.log(text),
      open: () => $.ui.open({ id: PANE_ID, title: 'Workflow' }),
      session: { id, repo: (repo?.remote ?? repo?.root ?? e.cwd ?? '').replace(/\.git$/, '').split('/').slice(-2).join('/') },
      post:
        url && token
          ? body =>
              $.http.fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
              })
          : null,
    }
    nowMs = await $.clock.now()
    const surfaces = await $.session.surfaces()
    drawing = surfaces.some(s => s === 'terminal' || s === 'desktop')
    await $.command
      .register({ name: 'wf', description: 'Workflow durumunu göster', immediate: true })
      .catch(() => {})
    return next(e)
  })

  // Workflow başlatıldığında run'ı kaydet
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const res = await next(e)
    const r = res?.result
    if (r && r.taskId && r.status === 'async_launched') {
      const startedAt = await $.clock.now()
      let phases = []
      if (r.scriptPath) {
        try {
          phases = phasesOf(await $.fs.read(r.scriptPath))
        } catch {}
      }
      runs.set(r.taskId, {
        taskId: r.taskId,
        name: r.workflowName ?? e.name ?? 'workflow',
        transcriptDir: r.transcriptDir,
        phases,
        status: 'running',
        startedAt,
        endedAt: null,
        agents: [],
        done: 0,
        lastLabel: null,
      })
      nowMs = startedAt
      startPolling()
      await openPane()
      await push()
    }
    return res
  })

  // Workflow agent'larının son adımı
  on('tool.call', async ($, e, next) => {
    if (e.agentId && hasRunning()) lastAction.set(e.agentId, describe(e))
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await reconcile(e.background_tasks)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await reconcile(e.background_tasks)
    return next(e)
  })

  // Çizen yüzeylerde bitiş bildirimi satırı da durumu söyler
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const task = e.props?.task
    const run = task?.id ? runs.get(task.id) : undefined
    if (run && run.status === 'running' && task.status) await finish(run, task.status)
    return next(e)
  })

  on('command.run', { command: 'wf' }, async ($, e, next) => {
    nowMs = await $.clock.now()
    for (const run of runs.values()) if (run.status === 'running') await refresh(run)
    if (runs.size > 0) await openPane()
    return { text: summaryText() }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    paneOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns ?? 60) - 2)
    const blocks = []
    if (runs.size === 0) blocks.push(h(Text, { dimColor: true }, 'Henüz workflow yok.'))
    for (const r of [...runs.values()].reverse()) {
      const v = view(r)
      const active = v.agents.filter(a => a.active)
      const color = v.status === 'running' ? 'yellow' : v.status === 'failed' ? 'red' : 'green'
      const rows = [
        h(Text, { bold: true, color }, short(`${v.name} · ${v.status} · ${since(v.elapsedMs)}`, width)),
        h(Text, null, `başlayan ${v.agents.length}  aktif ${active.length}  biten ${v.done}`),
      ]
      if (v.phases.length) rows.push(h(Text, { dimColor: true }, short(v.phases.join(' → '), width)))
      if (v.lastLabel) rows.push(h(Text, { dimColor: true }, short('son dönen: ' + v.lastLabel, width)))
      if (v.status === 'running') {
        for (const a of active) rows.push(h(Text, null, short(`${a.id}  ${a.last ?? '…'}`, width)))
      }
      blocks.push(h(Box, { key: r.taskId, flexDirection: 'column' }, ...rows))
    }
    return h(Box, { flexDirection: 'column', gap: 1 }, ...blocks)
  })
}
