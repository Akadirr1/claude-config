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
const MAX_RUNS = 10 // payload'da ve bellekte tutulan bitmiş run sayısı
const MAX_UNKNOWN = 50 // run'ı bilinmeyen agent'lar için stepLog girdisi
const RECHECK_MS = 60000 // tahminle biten run'ın journal'ı bu kadar daha izlenir
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
let failStreak = 0 // ardışık başarısız push; geri çekilme için
let nextTryAt = 0

// ---- saf yardımcılar ----

function short(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function clip(s, n) {
  const t = String(s ?? '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// Anahtar adının öneki ([\w.-]*) eşleşmeye katılmaz: maskelenen değeri değiştirmez, yalnız geri izlemeyi büyütür (ReDoS)
const KV =
  /((?:token|secret|passw(?:or)?d|pass|pwd|api[_-]?key|apikey|key|auth(?:orization)?|credential)s?["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"',;&)}\]]+)/gi

export function mask(s) {
  return String(s ?? '')
    .replace(/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g, '[private key ***]')
    .replace(/(:\/\/)[^\s/@]{1,256}@/g, '$1***@')
    .replace(/(--(?:password|passwd|pass|token|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi, '$1***')
    .replace(/(^|\s)-u\s+[^\s:]+:\S+/g, '$1-u ***')
    .replace(/\b(sk-)[\w-]{8,}/g, '$1***')
    .replace(/\b(sk_live_|sk_test_|rk_live_|rk_test_|pk_live_)[A-Za-z0-9]{8,}/g, '$1***')
    .replace(/\b(glpat-)[\w-]{16,}/g, '$1***')
    .replace(/\b(npm_|hf_)[A-Za-z0-9]{20,}/g, '$1***')
    .replace(/\bAIza[\w-]{30,}/g, 'AIza***')
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

// maskelemeden önce kırp: regex maliyeti girdinin boyuna bağlı kalmasın
const cut = (s, n = 240) => clip(mask(String(s ?? '').slice(0, n * 4)), n)
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

// Gövde 240 KB'ı geçerse: en eski teslim edilmiş bitmiş run'ları at, sonra adım/sonuçları kısalt,
// sonra en eskileri at (son durumu teslim edilmemiş olanlar = keep, en son)
export function fit(body, keep = new Set()) {
  const enc = new TextEncoder()
  let s = ''
  const over = () => enc.encode((s = JSON.stringify(body))).length > MAX_BYTES
  const drop = pred => {
    while (over() && body.runs.length > 1) {
      const i = body.runs.findIndex(pred)
      if (i < 0) break
      body.runs.splice(i, 1)
    }
  }
  drop(r => r.status !== 'running' && !keep.has(r.taskId))
  for (const n of [3, 0]) {
    if (!over()) return s
    for (const r of body.runs)
      for (const a of r.agents) {
        a.steps = n ? a.steps.slice(-n) : []
        if (!n) a.result = null
      }
  }
  drop(r => !keep.has(r.taskId))
  drop(() => true)
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

// URL'deki kullanıcı bilgisi (user:token@) atılır, kalan da maskelenir
const repoName = raw =>
  mask(clip(String(raw ?? '').replace(/\/\/[^/@\s]*@/, '//').replace(/\.git$/, '').split('/').slice(-2).join('/'), 200))

function phasesOf(source) {
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/.exec(source)
  if (!meta) return []
  return [...meta[1].matchAll(/title:\s*['"`]([^'"`]+)['"`]/g)].map(m => clip(m[1], 120))
}

// journal'ı baştan yürür: başlama sırası, dalga, durum, sonuç
function walk(run, text) {
  const order = []
  let wave = -1
  let fresh = true // mevcut dalga başladıktan sonra result/failed geldi mi
  const start = id => {
    let a = run.byId.get(id)
    if (!a) {
      a = { id, label: '', phase: null, agentType: null, metaSig: null, stoppedByUser: false, seenAt: nowMs, endedAt: null, result: null }
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
  if (a.jstatus === 'done') return 'done'
  if (a.stoppedByUser) return 'stopped'
  if (a.jstatus === 'failed') return 'failed'
  if (run.status === 'running') return 'running'
  return run.status === 'failed' ? 'failed' : 'stopped'
}

function hasRunning() {
  for (const r of runs.values()) if (r.status === 'running') return true
  return false
}

function runOf(agentId) {
  for (const r of runs.values()) if (r.byId.has(agentId)) return r
}

const rechecking = r => !r.sure && r.status !== 'running' && r.recheckUntil > nowMs

// sürmesi gereken iş: çalışan run, teslim edilmemiş son durum, tahmini bitişin yeniden kontrolü
function needPoll() {
  for (const r of runs.values()) if (r.status === 'running' || (host?.post && !r.delivered) || rechecking(r)) return true
  return false
}

// en yeni MAX_RUNS dışındaki bitmiş ve teslim edilmiş run'ları ve agent adımlarını unut
function prune() {
  const old = [...runs.values()].filter(r => r.status !== 'running' && (r.delivered || !host?.post) && !rechecking(r))
  for (const r of old.slice(0, -MAX_RUNS)) {
    runs.delete(r.taskId)
    for (const id of r.byId.keys()) stepLog.delete(id)
  }
}

// run'ı bilinmeyen agent'ların adımlarından yalnız en yeni MAX_UNKNOWN tanesi
function trimLog() {
  const unknown = [...stepLog.keys()].filter(id => !runOf(id))
  for (const id of unknown.slice(0, -MAX_UNKNOWN)) stepLog.delete(id)
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

// gönderilecek en fazla MAX_RUNS run: çalışanlar ve son durumu teslim edilmemişler önce, kalan yere en yeniler
function pick() {
  const all = [...runs.values()]
  const need = r => r.status === 'running' || !r.delivered
  let room = MAX_RUNS - all.filter(need).length
  const out = []
  for (const r of all.reverse()) if (need(r) || room-- > 0) out.unshift(r)
  return out.slice(-MAX_RUNS)
}

async function push() {
  if (!host || !host.post || runs.size === 0 || nowMs < nextTryAt) return
  const sent = pick()
  const list = maskDeep(sent.map(view))
  const key = JSON.stringify(list)
  if (key === lastKey && nowMs - lastPushAt < HEARTBEAT_MS) return
  lastKey = key
  lastPushAt = nowMs
  const body = { v: 2, session: host.session, sentAt: nowMs, runs: list }
  const s = fit(body, new Set(sent.filter(r => r.status !== 'running' && !r.delivered).map(r => r.taskId)))
  const ok = await host.post(s).then(res => res?.ok === true, () => false)
  if (!ok) {
    lastKey = '' // aynı durum yeniden denenir; 2 sn'den 60 sn'ye üstel geri çekilerek
    failStreak++
    nextTryAt = nowMs + Math.min(60_000, 1000 * 2 ** failStreak)
    return
  }
  failStreak = 0
  nextTryAt = 0
  for (const v of body.runs) {
    const r = runs.get(v.taskId)
    if (r && v.status !== 'running' && r.status === v.status) r.delivered = true
  }
}

const pushSoon = () => void push().catch(() => {})

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
    a.label = clip(m.description ?? a.label, 240)
    a.phase = m.workflowPhase == null ? null : clip(m.workflowPhase, 120)
    a.agentType = m.agentType ?? null
    a.stoppedByUser = m.stoppedByUser === true
    return true
  } catch {
    return false
  }
}

// run başına tek uçuş: süren refresh varsa onu bekle
function refresh(run) {
  return (run.busy ??= readRun(run).finally(() => (run.busy = null)))
}

async function readRun(run) {
  if (!host || !run.transcriptDir) return
  let entries
  try {
    entries = await host.list(run.transcriptDir)
  } catch {
    return
  }
  const names = new Map(entries.map(ent => [ent.name, ent]))
  const journal = names.get('journal.jsonl')
  // journal yalnız boyutu değiştiyse yeniden okunur; boyut yoksa (undefined !== sayı) her seferinde
  if (journal && journal.size !== run.journalSize) {
    try {
      const text = await host.read(`${run.transcriptDir}/journal.jsonl`)
      run.journalSize = journal.size ?? text.length
      walk(run, text)
    } catch {}
  }
  // meta, mtime/boyutu değişince (ya da boyut bilinmiyorsa her seferinde) yeniden okunur
  for (const a of run.agents) {
    const ent = names.get(`agent-${a.id}.meta.json`)
    if (!ent) continue
    const sig = `${ent.mtimeMs}:${ent.size}`
    if ((ent.size == null || sig !== a.metaSig) && (await readMeta(run, a))) a.metaSig = sig
  }
}

// sure: kesin kaynak (bildirim, TaskStop, UserMessage). Tahmini bitiş kesini ezmez, kesin tahmini ezer.
async function finish(run, status, sure) {
  const stale = () => !host || run.sure || (!sure && run.status !== 'running')
  if (stale()) return
  nowMs = await host.now()
  await refresh(run) // son durumu bir kez daha oku
  for (const a of run.agents) if (a.jstatus === 'running') await readMeta(run, a)
  if (stale()) return // beklerken kesin sonuç geldiyse tahmin onu ezmesin
  if (!sure) status = run.agents.some(a => a.jstatus === 'running') ? 'stopped' : 'done'
  const was = run.status
  run.status = status
  run.sure = sure
  run.endedAt ??= nowMs
  run.endSize = run.journalSize
  run.recheckUntil = sure ? 0 : nowMs + RECHECK_MS
  if (was !== status) {
    run.delivered = false
    const done = run.agents.filter(a => a.jstatus === 'done').length
    const msg = `workflow ${run.name}: ${TR[status]} (${since(run.endedAt - run.startedAt)}, ${done} agent sonucu)`
    if (drawing) host.toast(msg)
    host.log(msg)
  }
  startPolling() // son durum teslim edilene / yeniden kontrol bitene kadar; poll kendini kapatır
  redraw()
  pushSoon()
}

// Tahminle biten run'da aktivite kanıtı: yeniden çalışıyor
function reopen(run) {
  if (!host || run.sure || run.status === 'running') return
  run.status = 'running'
  run.endedAt = null
  run.delivered = false
  run.recheckUntil = 0
  host.log(`workflow ${run.name}: ${TR.running} (tahmini bitiş geri alındı)`)
  startPolling()
  redraw()
  pushSoon()
}

async function poll() {
  if (!host) return
  nowMs = await host.now()
  for (const run of [...runs.values()]) {
    if (run.status === 'running') await refresh(run)
    else if (rechecking(run)) {
      await refresh(run)
      if (run.journalSize !== run.endSize) reopen(run)
    }
  }
  redraw()
  await push()
  prune()
  if (poller && !needPoll()) {
    poller.cancel()
    poller = null
  }
}

function startPolling() {
  if (host && !poller) poller = host.every(POLL_MS, () => void poll().catch(() => {}))
}

async function openPane() {
  if (!host || !drawing) return
  paneOpen = true
  await host.open().catch(() => {})
}

async function reconcile(tasks, agentId) {
  if (!Array.isArray(tasks)) return
  for (const run of [...runs.values()]) {
    const t = tasks.find(x => x.id === run.taskId)
    if (run.status !== 'running') {
      // tahminle bitmiş run yeniden süren iş olarak listelendiyse ya da agent'ı durduysa sürüyordur
      if ((t && !STATUS[t.status]) || (agentId && run.byId.has(agentId))) reopen(run)
      continue
    }
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
      session: { id, repo: repoName(repo?.remote ?? repo?.root ?? e.cwd) },
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
        name: clip(r.workflowName ?? e.name ?? 'workflow', 120),
        transcriptDir: r.transcriptDir,
        phases,
        status: 'running',
        sure: false,
        startedAt,
        endedAt: null,
        agents: [],
        byId: new Map(),
        journalSize: -1,
        delivered: false,
        recheckUntil: 0,
      })
      nowMs = startedAt
      startPolling()
      await openPane()
      pushSoon()
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

  // Workflow agent'larının son adımları; tahminle bitmiş run'ın agent'ı çalışıyorsa run sürüyordur
  on('tool.call', async ($, e, next) => {
    const run = e.agentId ? runOf(e.agentId) : undefined
    if (e.agentId && (run || hasRunning())) {
      const t = await $.clock.now()
      const log = stepLog.get(e.agentId) ?? { first: t, list: [] }
      log.list.push({ t, text: short(mask(String(describe(e)).slice(0, 2000)), 160) })
      if (log.list.length > MAX_STEPS) log.list.shift()
      stepLog.set(e.agentId, log)
      if (!run) trimLog()
    }
    if (run) reopen(run)
    return next(e)
  })

  // Bitiş bildirimi: <task-notification><task-id>ID</task-id>...<status>completed|failed|killed</status>
  on('prompt.submit', async ($, e, next) => {
    const res = await next(e)
    if (e.origin?.kind === 'task-notification' && runs.size) {
      // blok başına yalnız ilk <task-id> ve ilk <status>: özet metnine gömülü sahte etiketler sayılmaz
      for (const [, block] of String(e.text ?? '').matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const run = runs.get(/<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(block)?.[1])
        const status = STATUS[/<status>\s*([^<]+?)\s*<\/status>/.exec(block)?.[1]]
        if (run && status) await finish(run, status, true)
      }
    }
    return res
  })

  on('classic.Stop', async ($, e, next) => {
    await reconcile(e.background_tasks, null)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await reconcile(e.background_tasks, e.agent_id)
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
