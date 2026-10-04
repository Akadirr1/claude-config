// wf-monitor: dynamic workflow run'larını izler.
// Veri kaynakları:
//   - Workflow tool sonucu: taskId, workflowName, transcriptDir, scriptPath
//   - transcriptDir/journal.jsonl: launched / started / result / failed satırları (sıra → dalga, result → biten)
//   - transcriptDir/agent-<id>.meta.json: label (description), phase (workflowPhase), agentType, stoppedByUser
//   - workflow agent'larının tool.call event'leri (agentId): son adımlar
//   - Bitiş: task-notification prompt'u, TaskStop, UserMessage props.task (kesin);
//     Stop / SubagentStop background_tasks'ten kaybolma (tahmini)
// Çıktılar:
//   - Terminal / Desktop: yan pane
//   - Her yerde (cloud dahil): /wf metin özeti
//   - WF_MONITOR_URL + WF_MONITOR_TOKEN tanımlıysa: durumu dashboard'a POST eder (sözleşme v2)

const PANE_ID = 'wf-monitor'
const POLL_MS = 2000
const HEARTBEAT_MS = 15000
const MAX_STEPS = 10
const MAX_BYTES = 240 * 1024
const STATUS = { completed: 'done', failed: 'failed', killed: 'stopped', done: 'done', stopped: 'stopped' }
const TR = { running: 'çalışıyor', done: 'bitti', failed: 'hata', stopped: 'durduruldu' }

const runs = new Map() // taskId -> run
const stepLog = new Map() // agentId -> { first, list: {t, text}[] }
let host = null // session.start'ta kurulan, mods API çağrılarını saran fonksiyonlar
let drawing = false
let paneOpen = false
let poller = null // $.clock.every tutamacı ({ cancel })
let nowMs = 0
let lastKey = ''
let lastPushAt = 0

// ---- saf yardımcılar ----

function short(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function clip(s, n) {
  const t = String(s ?? '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const KV =
  /([\w.-]*(?:token|secret|passw(?:or)?d|api[_-]?key|apikey|key|authorization|credential)s?["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"',;&)}\]]+)/gi

export function mask(s) {
  return String(s ?? '')
    .replace(/\b(sk-)[\w-]{8,}/g, '$1***')
    .replace(/\b(gh[pousr]_)[A-Za-z0-9]{10,}/g, '$1***')
    .replace(/\b(github_pat_)\w{10,}/g, '$1***')
    .replace(/\b(xox[abprs]-)[\w-]{8,}/g, '$1***')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***')
    .replace(/\beyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]*/g, '***')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 ***')
    .replace(KV, (m, k, v) => k + (v[0] === '"' ? '"***"' : v[0] === "'" ? "'***'" : '***'))
}

function maskDeep(v) {
  if (typeof v === 'string') return mask(v)
  if (Array.isArray(v)) return v.map(maskDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]))
  return v
}

const cut = (s, n = 240) => clip(mask(s), n)
const strs = a => (Array.isArray(a) ? a : []).slice(0, 20).map(x => cut(x))
const objs = a => (Array.isArray(a) ? a : []).slice(0, 20).map(x => x ?? {})

export function summarize(r) {
  if (r == null) return null
  if (typeof r === 'string') return { kind: 'text', text: cut(r, 600) }
  if (typeof r === 'object' && !Array.isArray(r)) {
    if (Array.isArray(r.criteria))
      return { kind: 'spec', criteria: strs(r.criteria), files: strs(r.files), outOfScope: strs(r.outOfScope), risks: strs(r.risks) }
    if (Array.isArray(r.findings))
      return {
        kind: 'review',
        findings: objs(r.findings).map(f => ({ severity: cut(f.severity), where: cut(f.where), issue: cut(f.issue), fix: cut(f.fix) })),
      }
    if (Array.isArray(r.checks))
      return {
        kind: 'qa',
        pass: r.pass === true,
        commands: strs(r.commands),
        checks: objs(r.checks).map(c => ({ criterion: cut(c.criterion), ok: c.ok === true, evidence: cut(c.evidence) })),
      }
  }
  return { kind: 'text', text: cut(JSON.stringify(r), 600) }
}

const roundOf = label => Number(/#(\d+)/.exec(label)?.[1] ?? 1)

function roleOf(label, agentType) {
  if (/^ba\b/i.test(label)) return 'ba'
  if (/^dev/i.test(label)) return 'dev'
  if (/review/i.test(label) || /^reviewer-/.test(agentType ?? '')) return 'review'
  if (/^qa/i.test(label)) return 'qa'
  return 'other'
}

// k. dalgadaki her agent'a (k-1). dalgadaki her agent'tan kenar
export function edgesOf(agents, phases) {
  const edges = []
  for (const to of agents)
    for (const from of agents) {
      if (from.wave !== to.wave - 1) continue
      const pf = phases.indexOf(from.phase)
      const pt = phases.indexOf(to.phase)
      const loop = to.round > from.round || (pf >= 0 && pt >= 0 && pt < pf)
      edges.push({ from: from.id, to: to.id, kind: loop ? 'loop' : 'handoff' })
    }
  return edges
}

// Gövde 240 KB'ı geçerse: en eski bitmiş run'ları at, sonra adım/sonuçları kısalt, sonra en eskileri at
export function fit(body) {
  const enc = new TextEncoder()
  let s = ''
  const over = () => enc.encode((s = JSON.stringify(body))).length > MAX_BYTES
  while (over() && body.runs.length > 1) {
    const i = body.runs.findIndex(r => r.status !== 'running')
    if (i < 0) break
    body.runs.splice(i, 1)
  }
  for (const keep of [3, 0]) {
    if (!over()) return s
    for (const r of body.runs)
      for (const a of r.agents) {
        a.steps = keep ? a.steps.slice(-keep) : []
        if (!keep) a.result = null
      }
  }
  while (over() && body.runs.length > 1) body.runs.shift()
  const r = body.runs[0]
  while (over() && r.agents.length) {
    r.agents = r.agents.slice(Math.ceil(r.agents.length / 2))
    const ids = new Set(r.agents.map(a => a.id))
    r.edges = r.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }
  return s
}

function describe(e) {
  const arg = e.command ?? e.file_path ?? e.notebook_path ?? e.pattern ?? e.url ?? e.query ?? e.description
  return arg == null ? String(e.tool) : `${e.tool}: ${arg}`
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

// journal'ı baştan yürür: başlama sırası, dalga, durum, sonuç
function walk(run, text) {
  const order = []
  let wave = -1
  let fresh = true // mevcut dalga başladıktan sonra result/failed geldi mi
  const start = id => {
    let a = run.byId.get(id)
    if (!a) {
      a = { id, label: '', phase: null, agentType: null, metaRead: false, stoppedByUser: false, seenAt: nowMs, endedAt: null, result: null }
      run.byId.set(id, a)
    }
    if (!order.includes(a)) {
      if (fresh) wave++
      fresh = false
      a.wave = wave
      a.jstatus = 'running'
      order.push(a)
    }
    return a
  }
  for (const line of text.split('\n')) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row?.agentId) continue
    if (row.type === 'started') start(row.agentId)
    else if (row.type === 'result' || row.type === 'failed') {
      const a = start(row.agentId)
      a.jstatus = row.type === 'result' ? 'done' : 'failed'
      a.endedAt ??= nowMs
      if (row.type === 'result' && !a.result) a.result = summarize(row.result)
      fresh = true
    }
  }
  run.agents = order
}

function statusOf(run, a) {
  if (a.jstatus !== 'running') return a.jstatus
  if (a.stoppedByUser) return 'stopped'
  if (run.status === 'running') return 'running'
  return run.status === 'failed' ? 'failed' : 'stopped'
}

function hasRunning() {
  for (const r of runs.values()) if (r.status === 'running') return true
  return false
}

function redraw() {
  if (host && drawing && paneOpen) host.invalidate()
}

// Sözleşmedeki Run (maskelenmemiş)
function view(r) {
  const agents = r.agents.map(a => {
    const label = clip(a.label || a.id.slice(0, 8), 240)
    const status = statusOf(r, a)
    const log = stepLog.get(a.id)
    return {
      id: a.id,
      label,
      phase: a.phase,
      round: roundOf(label),
      role: roleOf(label, a.agentType),
      status,
      startedAt: Math.min(a.seenAt, log?.first ?? Infinity),
      endedAt: a.endedAt ?? (status === 'running' ? null : r.endedAt),
      wave: a.wave,
      steps: log ? log.list.slice() : [],
      result: a.result,
    }
  })
  return {
    taskId: r.taskId,
    name: r.name,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    phases: r.phases,
    agents,
    edges: edgesOf(agents, r.phases),
  }
}

async function push() {
  if (!host || !host.post || runs.size === 0) return
  const list = maskDeep([...runs.values()].slice(-10).map(view))
  const key = JSON.stringify(list)
  if (key === lastKey && nowMs - lastPushAt < HEARTBEAT_MS) return
  lastKey = key
  lastPushAt = nowMs
  await host.post(fit({ v: 2, session: host.session, sentAt: nowMs, runs: list })).catch(() => {})
}

function counts(v) {
  const n = st => v.agents.filter(a => a.status === st).length
  const failed = n('failed')
  return { active: v.agents.filter(a => a.status === 'running'), done: n('done'), failed: failed ? ` / hata ${failed}` : '' }
}

const lastDone = v => [...v.agents].reverse().find(a => a.status === 'done')?.label
const lastStep = a => a.steps[a.steps.length - 1]?.text ?? '…'

function summaryText() {
  if (runs.size === 0) return 'Bu session\'da workflow çalışmadı.'
  const lines = []
  for (const r of runs.values()) {
    const v = view(r)
    const c = counts(v)
    lines.push(
      `${v.name} · ${TR[v.status]} · ${since((v.endedAt ?? nowMs) - v.startedAt)} · ` +
        `başlayan ${v.agents.length} / aktif ${c.active.length} / biten ${c.done}${c.failed}`,
    )
    if (v.phases.length) lines.push('  aşamalar: ' + v.phases.join(' → '))
    if (lastDone(v)) lines.push('  son dönen: ' + lastDone(v))
    for (const a of c.active) lines.push(`  ${a.label}  ${lastStep(a)}`)
  }
  return lines.join('\n')
}

async function readMeta(run, a) {
  try {
    const m = JSON.parse(await host.read(`${run.transcriptDir}/agent-${a.id}.meta.json`))
    a.label = String(m.description ?? a.label)
    a.phase = m.workflowPhase ?? null
    a.agentType = m.agentType ?? null
    a.stoppedByUser = m.stoppedByUser === true
    a.metaRead = true
  } catch {}
}

async function refresh(run) {
  if (!host || !run.transcriptDir) return
  let entries
  try {
    entries = await host.list(run.transcriptDir)
  } catch {
    return
  }
  const names = new Map(entries.map(ent => [ent.name, ent]))
  const journal = names.get('journal.jsonl')
  // journal yalnız boyutu değiştiyse yeniden okunur
  if (journal && journal.size !== run.journalSize) {
    try {
      const text = await host.read(`${run.transcriptDir}/journal.jsonl`)
      run.journalSize = journal.size
      walk(run, text)
    } catch {}
  }
  for (const a of run.agents) if (!a.metaRead && names.has(`agent-${a.id}.meta.json`)) await readMeta(run, a)
}

// sure: kesin kaynak (bildirim, TaskStop, UserMessage). Tahmini bitiş kesini ezmez, kesin tahmini ezer.
async function finish(run, status, sure) {
  if (!host || run.sure || (!sure && run.status !== 'running')) return
  nowMs = await host.now()
  await refresh(run) // son durumu bir kez daha oku
  for (const a of run.agents) if (a.jstatus === 'running') await readMeta(run, a)
  if (!sure) status = run.agents.some(a => a.jstatus === 'running') ? 'stopped' : 'done'
  const was = run.status
  run.status = status
  run.sure = sure
  run.endedAt ??= nowMs
  if (was !== status) {
    const done = run.agents.filter(a => a.jstatus === 'done').length
    const msg = `workflow ${run.name}: ${TR[status]} (${since(run.endedAt - run.startedAt)}, ${done} agent sonucu)`
    if (drawing) host.toast(msg)
    host.log(msg)
  }
  if (!hasRunning() && poller) {
    poller.cancel()
    poller = null
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
  if (host && !poller) poller = host.every(POLL_MS, () => void poll().catch(() => {}))
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
    const t = tasks.find(x => x.id === run.taskId)
    // background_tasks yalnızca hâlâ süren işleri listeler: listede yoksa bitmiştir (nasıl bittiği tahmin)
    if (!t) await finish(run, null, false)
    else if (STATUS[t.status]) await finish(run, STATUS[t.status], true)
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
                body,
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
        sure: false,
        startedAt,
        endedAt: null,
        agents: [],
        byId: new Map(),
        journalSize: -1,
      })
      nowMs = startedAt
      startPolling()
      await openPane()
      await push()
    }
    return res
  })

  // TaskStop ile durdurulan run kesin 'stopped'
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const res = await next(e)
    const run = runs.get(res?.result?.task_id ?? e.task_id)
    if (run && res?.result && !res.isError) await finish(run, 'stopped', true)
    return res
  })

  // Workflow agent'larının son adımları
  on('tool.call', async ($, e, next) => {
    if (e.agentId && hasRunning()) {
      const t = await $.clock.now()
      const log = stepLog.get(e.agentId) ?? { first: t, list: [] }
      log.list.push({ t, text: short(mask(describe(e)), 160) })
      if (log.list.length > MAX_STEPS) log.list.shift()
      stepLog.set(e.agentId, log)
    }
    return next(e)
  })

  // Bitiş bildirimi: <task-notification><task-id>ID</task-id>...<status>completed|failed|killed</status>
  on('prompt.submit', async ($, e, next) => {
    const res = await next(e)
    if (e.origin?.kind === 'task-notification' && runs.size) {
      for (const block of String(e.text ?? '').split('<task-notification>').slice(1)) {
        const run = runs.get(/<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(block)?.[1])
        const status = STATUS[/<status>\s*([^<]+?)\s*<\/status>/.exec(block)?.[1]]
        if (run && status) await finish(run, status, true)
      }
    }
    return res
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
    if (run && STATUS[task.status]) await finish(run, STATUS[task.status], true)
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
      const c = counts(v)
      const color = { running: 'yellow', done: 'green', failed: 'red', stopped: 'gray' }[v.status]
      const rows = [
        h(Text, { bold: true, color }, short(`${v.name} · ${TR[v.status]} · ${since((v.endedAt ?? nowMs) - v.startedAt)}`, width)),
        h(Text, null, `başlayan ${v.agents.length}  aktif ${c.active.length}  biten ${c.done}${c.failed.replace(' /', ' ')}`),
      ]
      if (v.phases.length) rows.push(h(Text, { dimColor: true }, short(v.phases.join(' → '), width)))
      if (lastDone(v)) rows.push(h(Text, { dimColor: true }, short('son dönen: ' + lastDone(v), width)))
      for (const a of c.active) rows.push(h(Text, null, short(`${a.label}  ${lastStep(a)}`, width)))
      blocks.push(h(Box, { key: r.taskId, flexDirection: 'column' }, ...rows))
    }
    return h(Box, { flexDirection: 'column', gap: 1 }, ...blocks)
  })
}
