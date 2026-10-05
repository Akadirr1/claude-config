// Panel durumu: sunucudan gelen session görünümleri, yamaların birleştirilmesi, olay günlüğü,
// maliyet örnekleri ve anomali normları. Görünümler (live/costs/history) yalnız buradan okur.
import { arr, clsKey, each, mainKey, num, obj, str, stKey, STATUS, RUN_STATUS } from './util.js'

export const S = {
  index: new Map(), // sid -> özet (bütün session'lar)
  views: new Map(), // sid -> tam görünüm (canlı ya da açılmış olanlar)
  off: 0, // sunucu saati − tarayıcı saati
  route: 'live',
  sid: null, tid: null, pinned: false, agentId: null,
  filters: { handoff: true, end: true, error: true, warn: true, art: true },
  logs: new Map(), // sid -> Map(olay anahtarı -> olay)
  seen: new Map(), // sid -> Set(animasyonu oynamış düğüm/kenar anahtarları)
  samples: new Map(), // sid -> [{ t, cost }] (yanma hızı)
  norms: { cls: {}, wf: {} }, // sınıf ve workflow normları (son 30 gün): anomali ve tahmin
  flagged: new Set(), // bildirimi yapılmış anomali anahtarları
  replay: null, // { tid, t } geçmiş run'da zaman yolculuğu
  crit: false, // kritik yol vurgusu
  cmp: null, // { name, tid, runs, b, busy } run karşılaştırma
}
export const serverNow = () => Date.now() + S.off
// mod saati: push'un mod tarafındaki zamanı ile sunucunun alış zamanı arasındaki kayma düzeltilir
export const modNow = v => serverNow() - ((v?.receivedAt ?? 0) - (v?.sentAt ?? 0))

const tokens = t => {
  const o = obj(t)
  const x = { in: num(o.in) ?? 0, out: num(o.out) ?? 0, cr: num(o.cr) ?? 0, cw: num(o.cw) ?? 0, n: num(o.n) ?? 0, cost: num(o.cost) ?? 0, models: {} }
  for (const [m, y] of Object.entries(obj(o.models))) x.models[str(m)] = { in: num(y?.in) ?? 0, out: num(y?.out) ?? 0, cr: num(y?.cr) ?? 0, cw: num(y?.cw) ?? 0, cost: num(y?.cost) ?? 0 }
  return x
}
const steps = xs => each(xs, x => (x && typeof x === 'object' ? { t: num(x.t), text: str(x.text), tool: str(x.tool) } : null))
const tools = t => Object.fromEntries(Object.entries(obj(t)).filter(([, v]) => num(v) != null).slice(0, 40))
const graph = g => ({ g: num(obj(g).g) ?? 0, r: num(obj(g).r) ?? 0 })
// istek başına bağlam serisi: { t, c: bağlam, o: çıkış, r: cache okuma, w: cache yazma, x: araçlar }
const series = xs => each(xs, p => (p && typeof p === 'object' && num(p.c) != null ? { t: num(p.t), c: num(p.c), o: num(p.o) ?? 0, r: num(p.r) ?? 0, w: num(p.w) ?? 0, x: arr(p.x).slice(0, 4).map(str) } : null)).slice(-200)

export function normAgent(a, extra = {}) {
  if (!a || typeof a !== 'object' || (!extra.main && !str(a.id))) return null
  return {
    id: extra.main ? 'main' : str(a.id),
    main: !!extra.main,
    kind: extra.kind ?? 'sub',
    runId: extra.runId ?? null,
    label: extra.main ? 'Şef' : str(a.label) || str(a.id).slice(0, 8),
    cls: extra.main ? 'orchestrator' : clsKey(a.cls),
    status: extra.main ? mainKey(a.status) : stKey(a.status),
    startedAt: num(a.startedAt) ?? extra.startedAt ?? 0,
    endedAt: num(a.endedAt),
    phase: a.phase == null ? null : str(a.phase),
    round: Math.min(50, Math.max(1, Math.floor(num(a.round) ?? 1))),
    wave: num(a.wave) ?? 0,
    agentType: str(a.agentType),
    model: str(a.model),
    hint: str(a.hint),
    parent: str(a.parent) || 'main',
    steps: steps(a.steps),
    result: a.result && typeof a.result === 'object' ? a.result : null,
    tokens: tokens(a.tokens),
    tools: tools(a.tools),
    graph: graph(a.graph),
    series: series(a.series),
    ctx: { base: num(obj(a.ctx).base) ?? 0, peak: num(obj(a.ctx).peak) ?? 0 },
    // orkestratöre özgü
    goal: str(a.goal), answer: str(a.answer), turns: num(a.turns) ?? 0, since: num(a.since), tool: str(a.tool),
  }
}

export function normRun(r) {
  if (!r || typeof r !== 'object' || !str(r.taskId)) return null
  const startedAt = num(r.startedAt) ?? 0
  const run = {
    taskId: str(r.taskId),
    name: str(r.name) || 'workflow',
    parent: str(r.parent) || 'main',
    status: stKey(r.status),
    startedAt,
    endedAt: num(r.endedAt),
    phases: arr(r.phases).map(str),
    agents: [],
    edges: each(r.edges, e => (!e || typeof e !== 'object' || !str(e.from) || !str(e.to) ? null
      : { from: str(e.from), to: str(e.to), kind: e.kind === 'loop' ? 'loop' : 'handoff' })),
  }
  run.agents = each(r.agents, a => normAgent(a, { kind: 'wf', runId: run.taskId, startedAt }))
  return run
}

export function normView(v) {
  const o = obj(v)
  const receivedAt = num(o.receivedAt) ?? serverNow()
  return {
    id: str(o.id), repo: str(o.repo), firstAt: num(o.firstAt) ?? receivedAt, receivedAt, sentAt: num(o.sentAt) ?? receivedAt,
    main: o.main ? normAgent(o.main, { main: true, kind: 'main', startedAt: num(o.firstAt) ?? receivedAt }) : null,
    subs: each(o.subs, x => normAgent(x)),
    runs: each(o.runs, normRun),
    misc: tokens(o.misc),
    art: normArt(o.art),
    totals: normTotals(o.totals),
  }
}
// eserler: PR bağlantısı yalnız github.com/…/pull/N ise bağlantı olur (sunucu da süzer)
export const PR_RE = /^https:\/\/github\.com\/[\w.-]{1,100}\/[\w.-]{1,100}\/pull\/\d{1,9}$/
function normArt(a) {
  const o = obj(a)
  return {
    files: each(o.files, f => (str(f?.p) ? { p: str(f.p), n: num(f.n) ?? 1, t: num(f.t) ?? 0, by: arr(f.by).map(str) } : null)),
    commits: each(o.commits, c => (str(c?.sha) ? { sha: str(c.sha), branch: str(c.branch), msg: str(c.msg), t: num(c.t) ?? 0, by: str(c.by) } : null)),
    prs: each(o.prs, x => (PR_RE.test(str(x?.url)) ? { url: str(x.url), t: num(x.t) ?? 0, by: str(x.by) } : null)),
  }
}
function normTotals(t) {
  const o = obj(t)
  return {
    cost: num(o.cost) ?? 0, in: num(o.in) ?? 0, out: num(o.out) ?? 0, cr: num(o.cr) ?? 0, cw: num(o.cw) ?? 0, n: num(o.n) ?? 0,
    agents: num(o.agents) ?? 0, runs: num(o.runs) ?? 0,
    byClass: Object.fromEntries(Object.entries(obj(o.byClass)).map(([k, x]) => [clsKey(k), { cost: num(x?.cost) ?? 0, tokens: num(x?.tokens) ?? 0, n: num(x?.n) ?? 0 }])),
    byModel: Object.fromEntries(Object.entries(obj(o.byModel)).map(([k, x]) => [str(k), { cost: num(x?.cost) ?? 0, tokens: num(x?.tokens) ?? 0 }])),
    graph: graph(o.graph),
  }
}
export function normSummary(x) {
  const o = obj(x)
  if (!str(o.id)) return null
  return {
    id: str(o.id), repo: str(o.repo), firstAt: num(o.firstAt) ?? 0, receivedAt: num(o.receivedAt) ?? 0,
    startedAt: num(o.startedAt) ?? num(o.firstAt) ?? 0, lastAt: num(o.lastAt) ?? num(o.receivedAt) ?? 0,
    tag: /^[a-z0-9-]{1,30}$/.test(str(o.tag)) ? str(o.tag) : '',
    title: str(o.title), model: str(o.model), status: o.status == null ? null : mainKey(o.status), live: o.live === true,
    totals: normTotals(o.totals), subs: num(o.subs) ?? 0,
    runs: each(o.runs, r => (str(r?.taskId) ? { taskId: str(r.taskId), name: str(r.name), status: stKey(r.status), startedAt: num(r.startedAt) ?? 0, endedAt: num(r.endedAt) } : null)),
  }
}

// ---- yardımcı sorgular
export const allAgents = v => (v ? [...(v.main ? [v.main] : []), ...v.subs, ...v.runs.flatMap(r => r.agents)] : [])
export const findAgent = (v, id) => allAgents(v).find(a => a.id === id) ?? null
export const runOf = (v, a) => (a?.runId ? v?.runs.find(r => r.taskId === a.runId) : null)
export const lastStepT = a => a.steps.reduce((m, x) => (x.t != null && x.t > m ? x.t : m), a.startedAt)
export function agentEnd(a, v) {
  if (a.main) return v.main?.status !== 'idle' ? modNow(v) : Math.max(v.receivedAt - (v.receivedAt - v.sentAt), lastStepT(a))
  if (a.endedAt != null) return a.endedAt
  if (a.status === 'running') return modNow(v)
  const run = runOf(v, a)
  return run?.endedAt ?? lastStepT(a)
}
export const runEnd = (r, v) => r.endedAt ?? (r.status === 'running' ? modNow(v) : Math.max(r.startedAt, ...r.agents.map(a => agentEnd(a, v))))
export const sessionStart = v => Math.min(v.main?.startedAt || v.firstAt, v.firstAt, ...v.subs.map(x => x.startedAt || Infinity), ...v.runs.map(r => r.startedAt || Infinity))
export const isLive = v => v && (v.main?.status && v.main.status !== 'idle' || v.subs.some(x => x.status === 'running') || v.runs.some(r => r.status === 'running'))
export const newestRun = v => v?.runs.reduce((m, r) => (!m || r.startedAt > m.startedAt ? r : m), null) ?? null
export function current() {
  const v = S.views.get(S.sid) ?? null
  return { v, run: v?.runs.find(r => r.taskId === S.tid) ?? null }
}

function bucket(store, sid, make) {
  let b = store.get(sid)
  if (!b) store.set(sid, (b = make()))
  return b
}
export const seenOf = sid => bucket(S.seen, sid, () => new Set())

// ---- olay günlüğü: ardışık görünümlerin farkından türetilir. Bitiş kayıtları düzeltilebilir.
let onEvent = () => {}
export const setEventSink = f => (onEvent = f)

function logDiff(sid, prev, next, quiet) {
  const log = bucket(S.logs, sid, () => new Map())
  const fresh = []
  const add = (k, ev, overwrite) => {
    if (!overwrite && log.has(k)) return
    const was = log.get(k)
    log.set(k, ev)
    if (!quiet && (!was || was.text !== ev.text)) fresh.push(ev)
  }
  const oldSubs = new Map((prev?.subs ?? []).map(x => [x.id, x]))
  for (const x of next.subs) {
    if (!oldSubs.has(x.id))
      add(`sp${x.id}`, { type: 'handoff', icon: '✦', t: x.startedAt, agent: x.id, cls: x.cls, text: `Şef → ${x.label} doğdu` })
    const was = oldSubs.get(x.id)?.status
    if (x.status !== 'running' && x.status !== was)
      add(`e${x.id}`, { type: x.status === 'done' ? 'end' : 'error', icon: STATUS[x.status].i, t: x.endedAt ?? lastStepT(x), agent: x.id, cls: x.cls, text: endText(x) }, true)
  }
  const oldRuns = new Map((prev?.runs ?? []).map(r => [r.taskId, r]))
  for (const r of next.runs) {
    const pr = oldRuns.get(r.taskId)
    if (!pr) add(`rs${r.taskId}`, { type: 'handoff', icon: '◆', t: r.startedAt, run: r.taskId, text: `Şef → workflow ${r.name} başladı` })
    const byId = new Map(r.agents.map(a => [a.id, a]))
    const was = new Map((pr?.agents ?? []).map(a => [a.id, a]))
    const hadEdge = new Set((pr?.edges ?? []).map(e => `${e.from}>${e.to}`))
    for (const a of r.agents) {
      if (!was.has(a.id) && !r.edges.some(e => e.to === a.id))
        add(`s${a.id}`, { type: 'handoff', icon: '▶', t: a.startedAt, agent: a.id, cls: a.cls, run: r.taskId, text: `${a.label} başladı` })
      if (a.status !== 'running' && a.status !== was.get(a.id)?.status)
        add(`e${a.id}`, { type: a.status === 'done' ? 'end' : 'error', icon: STATUS[a.status].i, t: a.endedAt ?? r.endedAt ?? lastStepT(a), agent: a.id, cls: a.cls, run: r.taskId, text: endText(a) }, true)
    }
    for (const e of r.edges) {
      const from = byId.get(e.from), to = byId.get(e.to)
      if (!from || !to || hadEdge.has(`${e.from}>${e.to}`)) continue
      const loop = e.kind === 'loop'
      add(`h${e.from}>${e.to}`, { type: 'handoff', icon: loop ? '↺' : '→', loop, t: to.startedAt, agent: to.id, cls: to.cls, run: r.taskId, text: `${from.label} → ${to.label}${loop ? ` (tur ${to.round})` : ''}` })
    }
    if (r.status !== 'running' && r.status !== pr?.status)
      add(`re${r.taskId}`, { type: r.status === 'done' ? 'end' : 'error', icon: STATUS[r.status].i, t: r.endedAt ?? r.startedAt, run: r.taskId, text: `Workflow ${r.name} ${RUN_STATUS[r.status]}`, runEnd: r.status }, true)
  }
  const who = id => (!id || id === 'main' ? 'Şef' : next.subs.find(x => x.id === id)?.label ?? next.runs.flatMap(r => r.agents).find(x => x.id === id)?.label ?? 'agent')
  const agentOf = id => (id && id !== 'main' ? id : undefined)
  for (const c of next.art?.commits ?? [])
    add(`c${c.sha}`, { type: 'art', icon: '⊙', t: c.t, agent: agentOf(c.by), text: `${who(c.by)} commit ${c.sha.slice(0, 7)}: ${c.msg}` })
  for (const x of next.art?.prs ?? [])
    add(`p${x.url}`, { type: 'art', icon: '⇡', t: x.t, agent: agentOf(x.by), pr: true, text: `${who(x.by)} PR açtı: ${x.url.replace('https://github.com/', '')}` })
  for (const ev of fresh) onEvent(sid, ev)
}
const endText = a => (a.status === 'done' ? `${a.label} bitti` : a.status === 'failed' ? `${a.label} hata verdi` : `${a.label} durduruldu`)

export function warn(sid, key, ev) {
  const log = bucket(S.logs, sid, () => new Map())
  if (log.has(key)) return false
  log.set(key, { type: 'warn', icon: '⚠', ...ev })
  onEvent(sid, log.get(key))
  return true
}

function sample(v) {
  const xs = bucket(S.samples, v.id, () => [])
  const t = v.receivedAt
  const tok = v.totals.in + v.totals.out + v.totals.cr + v.totals.cw
  if (!xs.length || xs.at(-1).tok !== tok || t - xs.at(-1).t > 60000) xs.push({ t, cost: v.totals.cost, tok })
  while (xs.length > 240) xs.shift()
}

// Tam görünüm (snapshot, /api/sessions/:id). quiet: geçmişi bildirim olarak yayma.
export function setView(raw, quiet = true) {
  try {
    const v = normView(raw)
    if (!v.id) return null
    logDiff(v.id, S.views.get(v.id), v, quiet)
    S.views.set(v.id, v)
    sample(v)
    return v.id
  } catch {
    return null
  }
}

// SSE yaması: yalnız push edilen varlıklar gelir; önbellekteki görünüme birleştirilir.
export function applyPatch(sid, raw) {
  const prev = S.views.get(sid)
  if (!prev) return false
  try {
    const p = obj(raw)
    const next = { ...prev, subs: [...prev.subs], runs: [...prev.runs] }
    next.receivedAt = num(p.receivedAt) ?? prev.receivedAt
    next.sentAt = num(p.sentAt) ?? prev.sentAt
    if (str(p.repo)) next.repo = str(p.repo)
    if (p.main) next.main = normAgent(p.main, { main: true, kind: 'main', startedAt: prev.firstAt })
    if (p.misc) next.misc = tokens(p.misc)
    if (p.totals) next.totals = normTotals(p.totals)
    if (p.art) next.art = normArt(p.art)
    for (const x of each(p.subs, y => normAgent(y))) {
      const i = next.subs.findIndex(y => y.id === x.id)
      i >= 0 ? (next.subs[i] = x) : next.subs.push(x)
    }
    for (const r of each(p.runs, normRun)) {
      const i = next.runs.findIndex(y => y.taskId === r.taskId)
      i >= 0 ? (next.runs[i] = r) : next.runs.push(r)
    }
    next.subs.sort((a, b) => a.startedAt - b.startedAt)
    next.runs.sort((a, b) => a.startedAt - b.startedAt)
    logDiff(sid, prev, next, false)
    S.views.set(sid, next)
    sample(next)
    return true
  } catch {
    return false
  }
}

export function setSummary(raw) {
  const x = normSummary(raw)
  if (x) S.index.set(x.id, x)
  return x?.id ?? null
}

// Kilit yoksa en son güncellenen session ve onun en yeni run'ı izlenir.
export function pickDefault() {
  const v = S.pinned && S.views.get(S.sid)
  if (v) {
    if (S.tid && !v.runs.some(r => r.taskId === S.tid)) S.tid = newestRun(v)?.taskId ?? null
    if (!S.tid) S.tid = newestRun(v)?.taskId ?? null
    return
  }
  if (S.pinned && S.index.has(S.sid)) return // açılıyor (fetch bekleniyor)
  S.pinned = false
  const latest = [...S.views.values()].sort((a, b) => b.receivedAt - a.receivedAt)[0]
  S.sid = latest?.id ?? null
  S.tid = latest ? newestRun(latest)?.taskId ?? null : null
}

export async function loadSession(sid) {
  if (S.views.has(sid)) return true
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(sid), { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 401) return void (location.href = '/login')
    if (!r.ok) return false
    const d = await r.json()
    if (num(d.serverNow) != null) S.off = d.serverNow - Date.now()
    return !!setView(d.view, true)
  } catch {
    return false
  }
}

// Anomali ve tahmin normları: son 30 günün sınıf ortancaları
export async function loadNorms() {
  try {
    const r = await fetch(`/api/stats?days=30&tz=${-new Date().getTimezoneOffset()}`, { credentials: 'same-origin', cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json()
    S.norms.cls = Object.fromEntries(arr(d.byClass).map(c => [clsKey(c.key), { medDur: num(c.medDur) ?? 0, medCost: num(c.medCost) ?? 0, medTok: num(c.medTok) ?? 0, n: num(c.n) ?? 0 }]))
    S.norms.wf = Object.fromEntries(arr(d.workflows).map(w => [str(w.key), { avg: (num(w.cost) ?? 0) / Math.max(1, num(w.runs) ?? 1), avgTok: (num(w.tokens) ?? 0) / Math.max(1, num(w.runs) ?? 1), runs: num(w.runs) ?? 0 }]))
  } catch {}
}

// Çalışan agent'ın anomalileri: sessiz (adım yok), yavaş (sınıf ortancasının 2 katı), pahalı (3 katı)
export function anomalies(a, v) {
  if (a.main || a.status !== 'running') return []
  const out = []
  const now = modNow(v)
  const last = lastStepT(a)
  if (now - last > 4 * 60e3) out.push({ k: 'quiet', text: `${Math.round((now - last) / 60e3)} dk'dır adım yok` })
  const n = S.norms.cls[a.cls]
  if (n && n.n >= 3) {
    const dur = now - a.startedAt
    if (n.medDur && dur > Math.max(2 * n.medDur, 5 * 60e3)) out.push({ k: 'slow', text: `sınıf ortancasının ${(dur / n.medDur).toFixed(1)}× süresi` })
    const tok = a.tokens.in + a.tokens.out + a.tokens.cr + a.tokens.cw
    if (n.medTok && tok > Math.max(3 * n.medTok, 200_000)) out.push({ k: 'costly', text: `sınıf ortancasının ${(tok / n.medTok).toFixed(1)}× tokeni` })
  }
  return out
}
