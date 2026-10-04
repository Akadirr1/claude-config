// wf-monitor: session'daki bütün agentic işi izler — orkestratör (ana döngü), Agent aracıyla doğan
// alt agent'lar ve dynamic workflow run'ları — ve her birinin model bazında token kullanımını sayar.
// Veri kaynakları:
//   - turn.step (her model isteği, agentId ile): token kullanımı ve model; turn.start/turn.complete: orkestratör turu
//   - agent.spawn: alt agent'ın doğumu (açıklama, tip, model, prompt başı, ebeveyn)
//   - Workflow tool sonucu: taskId, workflowName, transcriptDir, scriptPath
//   - transcriptDir/journal.jsonl: launched / started / result / failed satırları (sıra → dalga, result → biten)
//   - transcriptDir/agent-<id>.meta.json: label (description), phase (workflowPhase), agentType, stoppedByUser
//   - workflow agent'larının tool.call event'leri (agentId): son adımlar
//   - Bitiş: task-notification prompt'u, TaskStop, UserMessage props.task (kesin);
//     Stop / SubagentStop background_tasks'ten kaybolma (tahmini)
// Çıktılar:
//   - Terminal / Desktop: yan pane
//   - Her yerde (cloud dahil): /wf metin özeti
//   - WF_MONITOR_URL + WF_MONITOR_TOKEN tanımlıysa: durumu dashboard'a POST eder (sözleşme v3, yalnız değişen varlıklar)

const PANE_ID = 'wf-monitor'
const POLL_MS = 2000
const HEARTBEAT_MS = 15000
const MAX_STEPS = 10
const MAX_BYTES = 240 * 1024
const MAX_RUNS = 10 // payload'da ve bellekte tutulan bitmiş run sayısı
const MAX_SUBS = 200 // bellekte tutulan bitmiş alt agent sayısı
const MAX_SUBS_PUSH = 40 // bir push'taki alt agent sayısı (kalanlar sonraki push'ta)
const MAX_MAIN_STEPS = 40
const MAX_ART_FILES = 300
const MAX_ART_COMMITS = 100
const MAX_ART_PRS = 30
const MAX_UNKNOWN = 50 // run'ı bilinmeyen agent'lar için stepLog girdisi
const RECHECK_MS = 60000 // tahminle biten run'ın journal'ı bu kadar daha izlenir
const STATUS = { completed: 'done', failed: 'failed', killed: 'stopped', done: 'done', stopped: 'stopped' }
const TR = { running: 'çalışıyor', done: 'bitti', failed: 'hata', stopped: 'durduruldu' }

const runs = new Map() // taskId -> run
const subs = new Map() // agentId -> Agent aracıyla doğan alt agent
const stepLog = new Map() // agentId -> { first, list: {t, text}[] }
const usage = new Map() // 'main' | agentId -> { byModel: { model: { in, out, cr, cw, n } } }
const toolMix = new Map() // 'main' | agentId -> { araç: sayı }
const graphUse = new Map() // 'main' | agentId -> { g: graphify çağrısı, r: Read/Grep/Glob }
const sent = new Map() // varlık anahtarı -> sunucuya teslim edilen imza
const art = { files: new Map(), commits: new Map(), prs: new Map() } // session'ın eserleri: değişen dosya, commit, PR
const main = { status: 'idle', since: 0, tool: null, goal: '', turns: 0, answer: '', model: null, steps: [] }
let epoch = 0 // süreç kimliği: mod yeniden yüklenince sunucu eski sayaçların üstüne yazmasın, ekler
let pushing = false
let host = null // session.start'ta kurulan, mods API çağrılarını saran fonksiyonlar
let drawing = false
let paneOpen = false
let poller = null // $.clock.every tutamacı ({ cancel })
let nowMs = 0
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
    .replace(/(^|\s)(?:-u\s*|--user[=\s]+)(?:"[^"]*"|'[^']*'|(?=\S*:)\S+)/g, '$1-u ***')
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

// Gövde 240 KB'ı geçerse kısalt: önce adımlar ve sonuçlar, sonra çalışmayan varlıklar atılır.
// Atılan varlık teslim edilmiş sayılmaz, sonraki push'ta yeniden denenir.
export function fit(body) {
  const enc = new TextEncoder()
  let s = ''
  const over = () => enc.encode((s = JSON.stringify(body))).length > MAX_BYTES
  if (!over()) return s
  const agents = () => [...body.subs, ...body.runs.flatMap(r => r.agents)]
  for (const n of [3, 0]) {
    if (body.main) body.main.steps = body.main.steps.slice(-Math.max(n, 5))
    for (const a of agents()) {
      a.steps = n ? a.steps.slice(-n) : []
      if (!n) a.result = null
    }
    if (!over()) return s
  }
  if (body.art) {
    body.art.files = body.art.files.slice(-50)
    if (!over()) return s
  }
  const drop = list => {
    for (let i = list.length - 1; i >= 0 && over(); i--) if (list[i].status !== 'running') list.splice(i, 1)
  }
  drop(body.subs)
  drop(body.runs)
  while (over() && body.subs.length) body.subs.shift()
  while (over() && body.runs.length > 1) body.runs.shift()
  const r = body.runs[0]
  while (over() && r?.agents.length) {
    r.agents = r.agents.slice(Math.ceil(r.agents.length / 2))
    const ids = new Set(r.agents.map(a => a.id))
    r.edges = r.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  }
  return s
}

// turn.step sonucundaki kullanım: { model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
export function addUsage(map, key, model, u) {
  if (!u) return
  const m = clip(String(u.model ?? model ?? '?'), 80)
  const by = (map.get(key) ?? map.set(key, { byModel: {} }).get(key)).byModel
  const x = (by[m] ??= { in: 0, out: 0, cr: 0, cw: 0, n: 0 })
  x.in += Number(u.input_tokens) || 0
  x.out += Number(u.output_tokens) || 0
  x.cr += Number(u.cache_read_input_tokens) || 0
  x.cw += Number(u.cache_creation_input_tokens) || 0
  x.n++
}

const GRAPHIFY = /\bgraphify\b/i
const READS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead'])
// graphify kullanımı: Bash'te graphify komutu ya da graphify skill'i; okuma: dosya tarayan araçlar
export function graphHit(e) {
  if (e.tool === 'Bash' && GRAPHIFY.test(String(e.command ?? ''))) return 'g'
  if (e.tool === 'Skill' && GRAPHIFY.test(String(e.skill ?? ''))) return 'g'
  if (/graphify/i.test(String(e.tool ?? ''))) return 'g'
  return READS.has(e.tool) ? 'r' : null
}

function countTool(key, e) {
  const mix = toolMix.get(key) ?? toolMix.set(key, {}).get(key)
  const name = clip(String(e.tool ?? '?'), 60)
  if (Object.keys(mix).length < 40 || mix[name]) mix[name] = (mix[name] ?? 0) + 1
  const hit = graphHit(e)
  if (hit) {
    const g = graphUse.get(key) ?? graphUse.set(key, { g: 0, r: 0 }).get(key)
    g[hit]++
  }
}

function describe(e) {
  const arg = e.command ?? e.file_path ?? e.notebook_path ?? e.pattern ?? e.url ?? e.query ?? e.description
  return arg == null ? String(e.tool) : `${e.tool}: ${arg}`
}

// Araç sonucundan eser: Edit/Write → dosya; git commit çıktısı → commit; gh/MCP çıktısındaki PR bağlantısı → PR
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const COMMIT = /^\[([^\]\s]{1,200})(?: \([^)]{1,40}\))? ([0-9a-f]{7,40})\] (.{0,300})$/m
const PR_URL = /https:\/\/github\.com\/[\w.-]{1,100}\/[\w.-]{1,100}\/pull\/\d{1,9}/g
function outText(res) {
  const r = res?.result
  if (typeof r === 'string') return r.slice(0, 20000)
  if (typeof r?.stdout === 'string') return r.stdout.slice(0, 20000)
  try {
    return JSON.stringify(r ?? '').slice(0, 20000)
  } catch {
    return ''
  }
}
export function artifactsOf(e, res) {
  const out = { files: [], commits: [], prs: [] }
  if (res?.isError) return out
  const path = e.file_path ?? e.notebook_path
  if (EDITS.has(e.tool) && typeof path === 'string') out.files.push(clip(path, 300))
  const bash = e.tool === 'Bash' ? String(e.command ?? '') : ''
  if (/\bgit\b[^\n]*\bcommit\b/.test(bash)) {
    const m = COMMIT.exec(outText(res))
    if (m) out.commits.push({ branch: m[1], sha: m[2], msg: m[3] })
  }
  if (/\bgh\s+pr\s+create\b/.test(bash) || /pull_?request/i.test(String(e.tool ?? '')))
    for (const u of new Set(outText(res).match(PR_URL) ?? [])) out.prs.push(u)
  return out
}
function addArtifacts(key, e, res, t) {
  const a = artifactsOf(e, res)
  const by = key === 'main' ? 'main' : key
  for (const p of a.files) {
    const f = art.files.get(p) ?? { p, n: 0, t, by: [] }
    f.n++
    f.t = t
    if (!f.by.includes(by) && f.by.length < 6) f.by.push(by)
    art.files.delete(p)
    art.files.set(p, f)
  }
  for (const c of a.commits) art.commits.set(c.sha, { ...c, t, by })
  for (const u of a.prs) if (!art.prs.has(u)) art.prs.set(u, { url: u, t, by })
  for (const [m, n] of [[art.files, MAX_ART_FILES], [art.commits, MAX_ART_COMMITS], [art.prs, MAX_ART_PRS]])
    while (m.size > n) m.delete(m.keys().next().value)
  if (a.files.length || a.commits.length || a.prs.length) touch()
}
const viewArt = () => ({ files: [...art.files.values()], commits: [...art.commits.values()], prs: [...art.prs.values()] })

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
  // Yeni dalga ancak mevcut dalganın hepsi bitince başlar: parallel() eşzamanlılık sınırında
  // kuyrukta bekleyen agent, kardeşlerinden biri bitince başlasa da aynı dalgadadır.
  // Sonucu hiç gelmeyecek agent (resume öncesi yarım kalan, kullanıcının durdurduğu) dalgayı açık tutmaz.
  const waveOpen = () => order.some(x => x.wave === wave && x.jstatus === 'running' && !x.stoppedByUser)
  let closed = false
  const start = id => {
    let a = run.byId.get(id)
    if (!a) {
      a = { id, label: '', phase: null, agentType: null, metaSig: null, stoppedByUser: false, seenAt: nowMs, endedAt: null, result: null }
      run.byId.set(id, a)
    }
    if (!order.includes(a)) {
      if (wave < 0 || closed || !waveOpen()) {
        wave++
        closed = false
      }
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
    if (row?.type === 'restoring' || row?.type === 'restored') closed = true
    if (!row?.agentId) continue
    if (row.type === 'started') start(row.agentId)
    else if (row.type === 'result' || row.type === 'failed') {
      const a = start(row.agentId)
      a.jstatus = row.type === 'result' ? 'done' : 'failed'
      a.endedAt ??= nowMs
      if (row.type === 'result' && !a.result) a.result = summarize(row.result)
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

// süren iş: orkestratör çalışıyor, çalışan alt agent ya da run
function active() {
  if (main.status !== 'idle') return true
  for (const sub of subs.values()) if (sub.status === 'running') return true
  for (const r of runs.values()) if (r.status === 'running' || rechecking(r)) return true
  return false
}

// en yeni MAX_RUNS / MAX_SUBS dışındaki bitmiş ve teslim edilmiş varlıkları ve sayaçlarını unut
function prune() {
  const forget = id => {
    stepLog.delete(id)
    usage.delete(id)
    toolMix.delete(id)
    graphUse.delete(id)
  }
  const doneRuns = [...runs.values()].filter(r => r.status !== 'running' && (delivered('r:' + r.taskId) || !host?.post) && !rechecking(r))
  for (const r of doneRuns.slice(0, -MAX_RUNS)) {
    runs.delete(r.taskId)
    sent.delete('r:' + r.taskId)
    for (const id of r.byId.keys()) forget(id)
  }
  const doneSubs = [...subs.values()].filter(x => x.status !== 'running' && (delivered('s:' + x.id) || !host?.post))
  for (const x of doneSubs.slice(0, -MAX_SUBS)) {
    subs.delete(x.id)
    sent.delete('s:' + x.id)
    forget(x.id)
  }
}

// run'ı ya da alt agent'ı bilinmeyen loop'ların adımlarından yalnız en yeni MAX_UNKNOWN tanesi
function trimLog() {
  const unknown = [...stepLog.keys()].filter(id => !runOf(id) && !subs.has(id))
  for (const id of unknown.slice(0, -MAX_UNKNOWN)) stepLog.delete(id)
}

// Sözleşmedeki orkestratör (maskelenmemiş)
function viewMain() {
  return {
    startedAt: epoch, status: main.status, since: main.since, tool: main.tool, goal: main.goal, turns: main.turns, answer: main.answer,
    model: main.model, steps: main.steps.slice(), usage: usage.get('main') ?? null,
    tools: toolMix.get('main') ?? {}, graph: graphUse.get('main') ?? { g: 0, r: 0 },
  }
}

// Sözleşmedeki alt agent (maskelenmemiş)
function viewSub(x) {
  const log = stepLog.get(x.id)
  return {
    id: x.id, label: x.label, agentType: x.agentType, model: x.model, hint: x.hint, parent: x.parent,
    status: x.status, startedAt: x.startedAt, endedAt: x.endedAt, background: x.background,
    steps: log ? log.list.slice() : [], result: x.result,
    usage: usage.get(x.id) ?? null, tools: toolMix.get(x.id) ?? {}, graph: graphUse.get(x.id) ?? { g: 0, r: 0 },
  }
}

// workflow ve alt agent dışındaki loop'lar (sıkıştırma, hafıza çatalları): toplam kullanım
function miscUsage() {
  const out = { byModel: {} }
  for (const [key, u] of usage) {
    if (key === 'main' || subs.has(key) || runOf(key)) continue
    for (const [m, x] of Object.entries(u.byModel)) {
      const y = (out.byModel[m] ??= { in: 0, out: 0, cr: 0, cw: 0, n: 0 })
      for (const k of ['in', 'out', 'cr', 'cw', 'n']) y[k] += x[k]
    }
  }
  return out
}

const sigs = new Map() // varlık anahtarı -> son hesaplanan imza (gönderilen hali)
const delivered = key => sigs.has(key) && sent.get(key) === sigs.get(key)

// Teslim edilmemiş varlıklar: çalışanlar önce, sonra en yeniler; sınırın ötesi sonraki push'a kalır
function pending(list, cap) {
  const out = list.filter(e => sent.get(e.key) !== e.sig)
  out.sort((a, b) => (b.v.status === 'running') - (a.v.status === 'running') || (b.v.startedAt ?? 0) - (a.v.startedAt ?? 0))
  return out.slice(0, cap)
}

async function push() {
  if (!host || !host.post || pushing || nowMs < nextTryAt) return
  const wf = new Set()
  for (const r of runs.values()) for (const id of r.byId.keys()) wf.add(id)
  const ent = (key, v) => {
    const m = maskDeep(v)
    const sig = JSON.stringify(m)
    sigs.set(key, sig)
    return { key, v: m, sig }
  }
  const runEnts = [...runs.values()].map(r => ent('r:' + r.taskId, view(r)))
  const subEnts = [...subs.values()].filter(x => !wf.has(x.id)).map(x => ent('s:' + x.id, viewSub(x)))
  const mainEnt = ent('main', viewMain())
  const artEnt = ent('art', viewArt())
  const artP = sent.get('art') !== artEnt.sig
  const runP = pending(runEnts, MAX_RUNS)
  const subP = pending(subEnts, MAX_SUBS_PUSH)
  const changed = runP.length || subP.length || sent.get('main') !== mainEnt.sig || artP
  // değişiklik yoksa yalnız iş sürerken heartbeat (panel "son güncelleme"yi taze tutar)
  if (!changed && (!active() || nowMs - lastPushAt < HEARTBEAT_MS)) return
  const body = {
    v: 3, session: host.session, epoch, sentAt: nowMs,
    main: mainEnt.v, misc: { usage: maskDeep(miscUsage()) },
    subs: subP.map(e => e.v), runs: runP.map(e => e.v),
    ...(artP && { art: artEnt.v }),
  }
  const s = fit(body)
  const keys = new Map([...runP, ...subP, mainEnt, artEnt].map(e => [e.key, e.sig]))
  const kept = ['main', ...(body.art ? ['art'] : []), ...body.runs.map(r => 'r:' + r.taskId), ...body.subs.map(x => 's:' + x.id)]
  pushing = true
  lastPushAt = nowMs
  const ok = await host.post(s).then(res => res?.ok === true, () => false)
  pushing = false
  if (!ok) {
    failStreak++ // aynı durum yeniden denenir; 2 sn'den 60 sn'ye üstel geri çekilerek
    nextTryAt = nowMs + Math.min(60_000, 1000 * 2 ** failStreak)
    return
  }
  failStreak = 0
  nextTryAt = 0
  for (const k of kept) if (keys.has(k)) sent.set(k, keys.get(k))
}

const pushSoon = () => void push().catch(() => {})

// teslim edilmemiş bir şey kaldı mı (poller açık kalsın)
function undelivered() {
  if (!host?.post) return false
  if (sent.get('main') !== sigs.get('main')) return true
  if (sigs.has('art') && sent.get('art') !== sigs.get('art')) return true
  for (const r of runs.values()) if (!delivered('r:' + r.taskId)) return true
  for (const x of subs.values()) if (!delivered('s:' + x.id)) return true
  return false
}

const needPoll = () => active() || undelivered()

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
      agentType: a.agentType,
      status,
      startedAt: Math.min(a.seenAt, log?.first ?? Infinity),
      endedAt: a.endedAt ?? (status === 'running' ? null : r.endedAt),
      wave: a.wave,
      steps: log ? log.list.slice() : [],
      result: a.result,
      usage: usage.get(a.id) ?? null,
      tools: toolMix.get(a.id) ?? {},
      graph: graphUse.get(a.id) ?? { g: 0, r: 0 },
    }
  })
  return {
    taskId: r.taskId,
    parent: r.parent,
    name: r.name,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    phases: r.phases,
    agents,
    edges: edgesOf(agents, r.phases),
  }
}


function counts(v) {
  const n = st => v.agents.filter(a => a.status === st).length
  const failed = n('failed')
  return { active: v.agents.filter(a => a.status === 'running'), done: n('done'), failed: failed ? ` / hata ${failed}` : '' }
}

const lastDone = v => [...v.agents].reverse().find(a => a.status === 'done')?.label
const lastStep = a => a.steps[a.steps.length - 1]?.text ?? '…'

const STATE = { idle: 'boşta', thinking: 'düşünüyor', tool: 'araç kullanıyor' }
const tokens = key => Object.values(usage.get(key)?.byModel ?? {}).reduce((s, x) => s + x.in + x.out + x.cr + x.cw, 0)
const fmtTok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))

function summaryText() {
  const lines = []
  if (main.turns || usage.has('main'))
    lines.push(`Şef · ${STATE[main.status] ?? main.status} · tur ${main.turns} · ${fmtTok(tokens('main'))} token`)
  if (subs.size) {
    const live = [...subs.values()].filter(x => x.status === 'running')
    const sum = [...subs.keys()].reduce((n, id) => n + tokens(id), 0)
    lines.push(`alt agent ${subs.size} · çalışan ${live.length} · ${fmtTok(sum)} token`)
    for (const x of live) lines.push(`  ${x.label}  ${stepLog.get(x.id)?.list.at(-1)?.text ?? '…'}`)
  }
  if (runs.size === 0) lines.push('Bu session\'da workflow çalışmadı.')
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
  run.recheckUntil = 0
  host.log(`workflow ${run.name}: ${TR.running} (tahmini bitiş geri alındı)`)
  startPolling()
  redraw()
  pushSoon()
}

const SUB_END = { answer: 'done', aborted: 'stopped', error: 'failed', refusal: 'failed' }

function endSub(x, status, t, answer) {
  if (!x || x.status === status) return
  x.status = status
  x.endedAt = status === 'running' ? null : t
  if (answer != null) x.result = summarize(String(answer))
  touch()
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

// orkestratör ya da agent'larda hareket: poller açık değilse aç (push'lar poll'da, en fazla 2 sn'de bir)
const touch = () => startPolling()

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
    epoch = nowMs
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
        parent: e.agentId ?? 'main',
        transcriptDir: r.transcriptDir,
        phases,
        status: 'running',
        sure: false,
        startedAt,
        endedAt: null,
        agents: [],
        byId: new Map(),
        journalSize: -1,
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

  // Her araç çağrısı: orkestratörün ya da agent'ın son adımları, araç karışımı, graphify kullanımı.
  // Tahminle bitmiş run'ın agent'ı çalışıyorsa run sürüyordur.
  on('tool.call', async ($, e, next) => {
    const t = await $.clock.now()
    const text = short(mask(String(describe(e)).slice(0, 2000)), 160)
    if (!e.agentId) {
      main.steps.push({ t, text, tool: clip(String(e.tool ?? ''), 60) })
      if (main.steps.length > MAX_MAIN_STEPS) main.steps.shift()
      countTool('main', e)
      Object.assign(main, { status: 'tool', tool: clip(String(e.tool ?? ''), 60), since: t })
      touch()
      try {
        const res = await next(e)
        addArtifacts('main', e, res, t)
        return res
      } finally {
        if (main.status === 'tool') Object.assign(main, { status: 'thinking', tool: null, since: await $.clock.now() })
      }
    }
    const run = runOf(e.agentId)
    const sub = subs.get(e.agentId)
    if (run || sub || hasRunning()) {
      const log = stepLog.get(e.agentId) ?? { first: t, list: [] }
      log.list.push({ t, text })
      if (log.list.length > MAX_STEPS) log.list.shift()
      stepLog.set(e.agentId, log)
      countTool(e.agentId, e)
      if (!run && !sub) trimLog()
      touch()
    }
    if (run) reopen(run)
    if (sub && sub.status !== 'running') endSub(sub, 'running', t)
    const res = await next(e)
    addArtifacts(e.agentId, e, res, t)
    return res
  })

  // Orkestratörün turu başlar: hedef kullanıcının metni (bildirimle başlayan turlar hedefi değiştirmez)
  on('turn.start', async ($, e, next) => {
    const t = await $.clock.now()
    main.turns++
    const text = String(e.text ?? '').trim()
    if (text && !/^<(task-notification|system-reminder)/.test(text)) main.goal = cut(text, 300)
    Object.assign(main, { status: 'thinking', tool: null, since: t })
    touch()
    return next(e)
  })

  // Her model isteği: token kullanımı agent'ına (ana döngü 'main') model bazında yazılır
  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? 'main'
    if (key === 'main') {
      main.model = clip(String(e.model ?? ''), 80) || main.model
      if (main.status === 'idle') Object.assign(main, { status: 'thinking', since: await $.clock.now() })
    } else {
      const sub = subs.get(key)
      if (sub && sub.status !== 'running') endSub(sub, 'running', await $.clock.now())
    }
    const r = yield* next(e)
    try {
      addUsage(usage, key, e.model, r?.usage)
      touch()
    } catch {}
    return r
  })

  // Tur biter: ana döngü boşa düşer; alt agent'ın tek turu bittiyse agent biter
  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    const t = await $.clock.now()
    if (!e.agentId) {
      Object.assign(main, { status: 'idle', tool: null, since: t, answer: cut(e.answer ?? '', 600) })
      touch()
    } else endSub(subs.get(e.agentId), SUB_END[e.reason] ?? 'done', t, e.answer)
    return res
  })

  // Agent aracıyla doğan alt agent: açıklaması, tipi, modeli, prompt'un başı, ebeveyni
  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (res?.agentId && !res.deny) {
      subs.set(res.agentId, {
        id: res.agentId,
        label: cut(e.description || res.agentId.slice(0, 8), 120),
        agentType: clip(String(e.subagentType ?? ''), 80),
        model: clip(String(res.model ?? e.model ?? ''), 80),
        hint: cut(e.prompt, 300),
        parent: e.agentId ?? 'main',
        status: 'running',
        startedAt: await $.clock.now(),
        endedAt: null,
        result: null,
      })
      touch()
    }
    return res
  })

  // Bitiş bildirimi: <task-notification><task-id>ID</task-id>...<status>completed|failed|killed</status>
  on('prompt.submit', async ($, e, next) => {
    const res = await next(e)
    if (e.origin?.kind === 'task-notification' && (runs.size || subs.size)) {
      // blok başına yalnız ilk <task-id> ve ilk <status>: özet metnine gömülü sahte etiketler sayılmaz
      for (const [, block] of String(e.text ?? '').matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const id = /<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(block)?.[1]
        const status = STATUS[/<status>\s*([^<]+?)\s*<\/status>/.exec(block)?.[1]]
        const run = runs.get(id)
        if (run && status) await finish(run, status, true)
        else if (status && subs.has(id)) endSub(subs.get(id), status, await $.clock.now())
      }
    }
    return res
  })

  on('classic.Stop', async ($, e, next) => {
    await reconcile(e.background_tasks, null)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const sub = subs.get(e.agent_id)
    if (sub?.status === 'running') endSub(sub, 'done', await $.clock.now(), e.last_assistant_message)
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
    if (main.turns || usage.has('main')) {
      const color = main.status === 'idle' ? 'gray' : 'yellow'
      const rows = [h(Text, { bold: true, color }, short(`Şef · ${STATE[main.status] ?? main.status} · tur ${main.turns} · ${fmtTok(tokens('main'))} token`, width))]
      if (main.goal) rows.push(h(Text, { dimColor: true }, short(main.goal, width)))
      for (const x of [...subs.values()].filter(x => x.status === 'running'))
        rows.push(h(Text, null, short(`  ↳ ${x.label}  ${stepLog.get(x.id)?.list.at(-1)?.text ?? '…'}`, width)))
      blocks.push(h(Box, { key: 'main', flexDirection: 'column' }, ...rows))
    }
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
