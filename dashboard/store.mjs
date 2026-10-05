// Kalıcı defter: session kayıtlarını birleştirir, diske yazar, maliyet/sınıf türetir ve analiz üretir.
// HTTP'den bağımsız saf fonksiyonlar + küçük bir depo; server.mjs yalnız bunu çağırır.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { classify } from './public/classes.js'
import { PRICES, costOf, modelKey } from './public/pricing.js'

const MAX_EPOCHS = 20
const MAX_SUBS = 2000
const MAX_RUNS = 500
const DETAIL_CACHE = 100
const LIVE_MS = 90 * 1000
const DAY = 86400 * 1000

const PR_RE = /^https:\/\/github\.com\/[\w.-]{1,100}\/[\w.-]{1,100}\/pull\/\d{1,9}$/
const MAX_FILES = 500, MAX_COMMITS = 200, MAX_PRS = 50
const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const num = v => (Number.isFinite(v) ? v : 0)
const str = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '')

// { byModel: { model: { in, out, cr, cw, n } } } → toplam ve maliyet
export function tally(usage, prices = PRICES) {
  const t = { in: 0, out: 0, cr: 0, cw: 0, n: 0, cost: 0, models: {} }
  const by = isObj(usage?.byModel) ? usage.byModel : {}
  for (const [model, u] of Object.entries(by)) {
    if (!isObj(u)) continue
    const x = { in: num(u.in), out: num(u.out), cr: num(u.cr), cw: num(u.cw), n: num(u.n) }
    x.cost = costOf(model, x, prices)
    for (const k of ['in', 'out', 'cr', 'cw', 'n', 'cost']) t[k] += x[k]
    const key = modelKey(model, prices) ?? str(model, 80)
    const m = (t.models[key] ??= { in: 0, out: 0, cr: 0, cw: 0, n: 0, cost: 0 })
    for (const k of ['in', 'out', 'cr', 'cw', 'n', 'cost']) m[k] += x[k]
  }
  return t
}

const mainModel = t => Object.entries(t.models).sort((a, b) => b[1].cost - a[1].cost)[0]?.[0] ?? null

function addUsage(a, b) {
  const out = { byModel: {} }
  for (const u of [a, b])
    for (const [m, x] of Object.entries(isObj(u?.byModel) ? u.byModel : {})) {
      const y = (out.byModel[m] ??= { in: 0, out: 0, cr: 0, cw: 0, n: 0 })
      for (const k of ['in', 'out', 'cr', 'cw', 'n']) y[k] += num(x?.[k])
    }
  return out
}

// v2 gövdesini v3 biçimine çevir (eski mod: yalnız workflow run'ları)
function upgrade(body) {
  if (body.v === 3) return body
  return { v: 3, session: body.session, sentAt: body.sentAt, epoch: 0, runs: body.runs, subs: [] }
}

export function validate(body) {
  if (!isObj(body) || (body.v !== 2 && body.v !== 3)) return false
  if (typeof body.session?.id !== 'string' || !body.session.id) return false
  if (!Array.isArray(body.runs) || !body.runs.every(r => isObj(r) && typeof r.taskId === 'string' && r.taskId)) return false
  if (body.v === 3) {
    if (body.subs !== undefined && (!Array.isArray(body.subs) || !body.subs.every(s => isObj(s) && typeof s.id === 'string' && s.id))) return false
    if (body.main !== undefined && body.main !== null && !isObj(body.main)) return false
  }
  return true
}

// Önceki kayda bir push'u birleştir. Varlıklar id ile upsert edilir; push yalnız değişenleri taşır.
export function merge(prev, raw, receivedAt) {
  const body = upgrade(raw)
  const rec = prev ?? { id: body.session.id, firstAt: receivedAt, mains: {}, misc: {}, subs: {}, runs: {} }
  rec.repo = str(body.session.repo, 200) || rec.repo || ''
  if (typeof body.session.branch === 'string') rec.branch = str(body.session.branch, 200)
  // ölçüm deneyi etiketi (mod, ilk mesajdaki [deney:ad]'dan)
  if (typeof body.session.tag === 'string' && /^[a-z0-9-]{1,30}$/.test(body.session.tag)) rec.tag = body.session.tag
  rec.receivedAt = receivedAt
  rec.sentAt = Number.isFinite(body.sentAt) ? body.sentAt : receivedAt
  const epoch = String(num(body.epoch))
  rec.lastEpoch = epoch
  if (isObj(body.main)) cleanCtx((rec.mains[epoch] = body.main))
  if (isObj(body.misc)) rec.misc[epoch] = body.misc
  for (const map of [rec.mains, rec.misc]) {
    const keys = Object.keys(map)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_EPOCHS))) delete map[k]
  }
  if (body.art !== undefined) rec.art = mergeArt(rec.art, body.art)
  for (const s of body.subs ?? []) cleanCtx((rec.subs[s.id] = s))
  for (const r of body.runs) {
    rec.runs[r.taskId] = r
    if (Array.isArray(r.agents)) r.agents.forEach(cleanCtx)
  }
  cap(rec.subs, MAX_SUBS, s => num(s.startedAt))
  cap(rec.runs, MAX_RUNS, r => num(r.startedAt))
  return rec
}

// Eserler: mod her seferinde kendi tam listesini yollar; epoch'lar arası birleşsin diye anahtarla upsert edilir.
// PR bağlantısı panelde <a href> olur: yalnız github.com/…/pull/N biçimi kabul edilir.
function mergeArt(prev, a) {
  const out = prev ?? { files: {}, commits: {}, prs: {} }
  if (!isObj(a)) return out
  const by = v => (Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string').slice(0, 6).map(x => str(x, 80))
  for (const f of Array.isArray(a.files) ? a.files.slice(0, MAX_FILES) : []) {
    if (!isObj(f) || typeof f.p !== 'string' || !f.p) continue
    const p = str(f.p, 300)
    const old = out.files[p]
    out.files[p] = { p, n: Math.max(num(f.n), num(old?.n)), t: Math.max(num(f.t), num(old?.t)), by: [...new Set([...(old?.by ?? []), ...by(f.by)])].slice(0, 6) }
  }
  for (const c of Array.isArray(a.commits) ? a.commits.slice(0, MAX_COMMITS) : [])
    if (isObj(c) && /^[0-9a-f]{7,40}$/.test(c.sha ?? '')) out.commits[c.sha] = { sha: c.sha, branch: str(c.branch, 200), msg: str(c.msg, 300), t: num(c.t), by: by(c.by)[0] ?? '' }
  for (const x of Array.isArray(a.prs) ? a.prs.slice(0, MAX_PRS) : [])
    if (isObj(x) && PR_RE.test(x.url ?? '') && !out.prs[x.url]) out.prs[x.url] = { url: x.url, t: num(x.t), by: by(x.by)[0] ?? '' }
  cap(out.files, MAX_FILES, f => f.t)
  cap(out.commits, MAX_COMMITS, c => c.t)
  cap(out.prs, MAX_PRS, x => x.t)
  return out
}
const artView = a => ({
  files: Object.values(a?.files ?? {}).sort((x, y) => y.t - x.t),
  commits: Object.values(a?.commits ?? {}).sort((x, y) => x.t - y.t),
  prs: Object.values(a?.prs ?? {}).sort((x, y) => x.t - y.t),
})

function cap(map, max, key) {
  const keys = Object.keys(map)
  if (keys.length <= max) return
  keys.sort((a, b) => key(map[a]) - key(map[b]))
  for (const k of keys.slice(0, keys.length - max)) delete map[k]
}

// İstemciye giden görünüm: her agent'a sınıf, token toplamı ve maliyet eklenir; session toplamları hesaplanır.
export function view(rec, prices = PRICES) {
  const latest = rec.mains[rec.lastEpoch] ?? Object.values(rec.mains).at(-1) ?? null
  const mainUsage = Object.values(rec.mains).reduce((u, m) => addUsage(u, m?.usage), { byModel: {} })
  const miscUsage = Object.values(rec.misc).reduce((u, m) => addUsage(u, m?.usage), { byModel: {} })
  const dress = (a, extra) => {
    const t = tally(a.usage, prices)
    return { ...a, ...extra, cls: classify({ ...a, ...extra }), tokens: t, model: a.model || mainModel(t) }
  }
  const main = latest
    ? { ...latest, main: true, cls: 'orchestrator', tokens: tally(mainUsage, prices), model: mainModel(tally(mainUsage, prices)) }
    : null
  const subs = Object.values(rec.subs).map(s => dress(s)).sort((a, b) => num(a.startedAt) - num(b.startedAt))
  const runs = Object.values(rec.runs)
    .map(r => ({ ...r, agents: (Array.isArray(r.agents) ? r.agents : []).filter(isObj).map(a => dress(a)) }))
    .sort((a, b) => num(a.startedAt) - num(b.startedAt))
  const misc = tally(miscUsage, prices)
  return { id: rec.id, repo: rec.repo, branch: rec.branch, tag: rec.tag ?? '', firstAt: rec.firstAt, receivedAt: rec.receivedAt, sentAt: rec.sentAt, main, subs, runs, misc, art: artView(rec.art), totals: totals(main, subs, runs, misc) }
}

function totals(main, subs, runs, misc) {
  const t = { cost: 0, in: 0, out: 0, cr: 0, cw: 0, n: 0, agents: 0, runs: runs.length, byClass: {}, byModel: {}, graph: { g: 0, r: 0 } }
  const add = (a, cls) => {
    const x = a.tokens
    for (const k of ['cost', 'in', 'out', 'cr', 'cw', 'n']) t[k] += x[k]
    const c = (t.byClass[cls] ??= { cost: 0, tokens: 0, n: 0 })
    c.cost += x.cost
    c.tokens += x.in + x.out + x.cr + x.cw
    c.n++
    for (const [m, y] of Object.entries(x.models)) {
      const z = (t.byModel[m] ??= { cost: 0, tokens: 0 })
      z.cost += y.cost
      z.tokens += y.in + y.out + y.cr + y.cw
    }
    t.graph.g += num(a.graph?.g)
    t.graph.r += num(a.graph?.r)
  }
  if (main) add(main, 'orchestrator')
  for (const s of subs) add(s, s.cls), t.agents++
  for (const r of runs) for (const a of r.agents) add(a, a.cls), t.agents++
  if (misc.n) add({ tokens: misc }, 'other')
  return t
}

const running = v =>
  v.main?.status && v.main.status !== 'idle' ||
  v.subs.some(s => s.status === 'running') ||
  v.runs.some(r => r.status === 'running')

// Bağlam serisi ve özeti push token'ından gelir: sınırlanır (nokta sayısı, metin boyu, sayı aralığı)
const MAX_SERIES = 200
const tokN = v => (Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : 0)
function cleanCtx(a) {
  if (!isObj(a)) return
  if (Array.isArray(a.series))
    a.series = a.series.slice(-MAX_SERIES).filter(isObj).map(p => ({
      t: num(p.t), i: tokN(p.i), c: tokN(p.c), o: tokN(p.o), r: tokN(p.r), w: tokN(p.w),
      x: Array.isArray(p.x) ? p.x.filter(x => typeof x === 'string').slice(0, 4).map(x => str(x, 80)) : [],
    }))
  else delete a.series
  if (isObj(a.ctx)) {
    const bt = Object.entries(isObj(a.ctx.byTool) ? a.ctx.byTool : {}).map(([k, v]) => [str(k, 60), tokN(v)]).filter(([k, v]) => k && v).sort((x, y) => y[1] - x[1]).slice(0, 20)
    a.ctx = {
      base: tokN(a.ctx.base),
      peak: tokN(a.ctx.peak),
      byTool: Object.assign(Object.create(null), Object.fromEntries(bt)),
      jumps: (Array.isArray(a.ctx.jumps) ? a.ctx.jumps : []).filter(isObj).slice(0, 3).map(j => ({ d: tokN(j.d), x: str(j.x, 300) })),
    }
  } else delete a.ctx
}

// Şişme özeti: mod'un bütün istekler üzerinden tuttuğu ctx varsa o (seri kırpılsa da doğru); yoksa seriden.
// Seride sıçrama = bağlam artışı − önceki çıkış; aradaki araçlara bölünür; inceltilmiş boşluk (i atlaması) sayılmaz.
export function bloatOf(series, ctx) {
  const out = { base: 0, peak: 0, jumps: [], byTool: Object.create(null) }
  const pts = (Array.isArray(series) ? series : []).slice(-MAX_SERIES).filter(isObj)
    .map(p => ({ i: tokN(p.i), c: tokN(p.c), o: tokN(p.o), x: Array.isArray(p.x) ? p.x.filter(x => typeof x === 'string').slice(0, 4).map(x => str(x, 80)) : [] }))
  for (const p of pts) out.peak = Math.max(out.peak, p.c)
  if (pts[0] && (!pts[0].i || pts[0].i === 1)) out.base = pts[0].c // taban: ilk istekteki bağlam
  if (isObj(ctx)) {
    out.peak = Math.max(out.peak, tokN(ctx.peak))
    if (tokN(ctx.base)) out.base = tokN(ctx.base)
    for (const [k, v] of Object.entries(isObj(ctx.byTool) ? ctx.byTool : {}).slice(0, 20)) if (tokN(v)) out.byTool[str(k, 60)] = tokN(v)
    out.jumps = (Array.isArray(ctx.jumps) ? ctx.jumps : []).filter(isObj).slice(0, 3).map(j => ({ d: tokN(j.d), x: str(j.x, 300) }))
    return out
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].i && pts[i - 1].i && pts[i].i - pts[i - 1].i !== 1) continue
    const d = pts[i].c - pts[i - 1].c - pts[i - 1].o
    if (d <= 0 || !pts[i].x.length) continue
    out.jumps.push({ d, x: pts[i].x.join(' · ') })
    const names = pts[i].x.map(x => (/^\+\d/.test(x) ? 'diğer' : x.split(':')[0].trim() || '?'))
    for (const n of names) out.byTool[n] = (out.byTool[n] ?? 0) + d / names.length
  }
  out.jumps = out.jumps.sort((a, b) => b.d - a.d).slice(0, 3)
  const top = Object.entries(out.byTool).sort((a, b) => b[1] - a[1]).slice(0, 20)
  out.byTool = Object.assign(Object.create(null), Object.fromEntries(top))
  return out
}

// Defter satırları: analiz ve CSV dışa aktarımı bunlardan yapılır (her agent bir satır)
export function rows(v) {
  const out = []
  // push token'ı sahibi 1e300 gibi zaman gönderirse tarih hesapları (toISOString) patlar
  const ts = x => (num(x) > 0 && num(x) < 8.64e15 ? num(x) : 0)
  const row = (kind, a, extra = {}) => {
    const t = a.tokens
    out.push({
      sid: v.id, repo: v.repo, kind, id: a.id ?? 'main', label: str(a.label, 120) || (kind === 'main' ? 'Şef' : '?'), cls: a.cls,
      agentType: str(a.agentType, 80), model: a.model ?? '', status: a.status ?? '', start: ts(a.startedAt), end: ts(a.endedAt),
      in: t.in, out: t.out, cr: t.cr, cw: t.cw, n: t.n, cost: t.cost, g: num(a.graph?.g), r: num(a.graph?.r), ...extra,
      ...(({ base, peak, jumps, byTool }) => ({ base, peak, jumps, bt: byTool }))(bloatOf(a.series, a.ctx)),
      tag: v.tag ?? '',
    })
  }
  if (v.main) row('main', v.main, { start: ts(v.main.startedAt) || v.firstAt, end: v.receivedAt, status: v.main.status ?? '' })
  for (const s of v.subs) row('sub', s)
  for (const r of v.runs) for (const a of r.agents) row('wf', a, { run: str(r.name, 120), runId: r.taskId, phase: str(a.phase, 80), round: num(a.round) || 1 })
  return out
}

// session'ın kendi saatiyle başlangıcı ve son etkinliği (geçmiş/yeniden gönderimde sunucu saatinden doğru)
function span(v) {
  const starts = [num(v.main?.startedAt), ...v.subs.map(x => num(x.startedAt)), ...v.runs.map(r => num(r.startedAt))].filter(Boolean)
  const ends = [num(v.sentAt), ...v.subs.map(x => num(x.endedAt)), ...v.runs.map(r => num(r.endedAt))].filter(Boolean)
  const startedAt = starts.length ? Math.min(...starts) : v.firstAt
  return { startedAt, lastAt: Math.max(startedAt, ...ends) }
}

export function summary(v) {
  return {
    id: v.id, repo: v.repo, branch: v.branch, tag: v.tag, firstAt: v.firstAt, receivedAt: v.receivedAt, ...span(v),
    title: str(v.main?.goal, 160), model: v.main?.model ?? null, status: v.main?.status ?? null,
    live: running(v), totals: { ...v.totals, byModel: undefined },
    runs: v.runs.map(r => ({ taskId: r.taskId, name: str(r.name, 120), status: r.status, startedAt: r.startedAt, endedAt: r.endedAt })),
    subs: v.subs.length,
    art: { files: v.art.files.length, commits: v.art.commits.length, prs: v.art.prs.map(x => x.url) },
  }
}

const median = xs => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
// tz: UTC'ye göre dakika (Türkiye +180); gün sınırları kullanıcının saatine göre
const dayOf = (t, tz = 0) => new Date(t + tz * 60000).toISOString().slice(0, 10)

// Analiz: rows → toplamlar, gün/sınıf/model/repo/workflow kırılımı, graphify etkisi, ısı haritası, sınıf normları
export function stats(allRows, { days = 7, repo = '', now = Date.now(), tz = 0 } = {}) {
  const from = days > 0 ? now - days * DAY : 0
  const rs = allRows.filter(r => (r.start || r.end) >= from && (!repo || r.repo === repo))
  const t = { cost: 0, in: 0, out: 0, cr: 0, cw: 0, n: 0, agents: 0, sessions: new Set(rs.map(r => r.sid)).size }
  for (const r of rs) {
    for (const k of ['cost', 'in', 'out', 'cr', 'cw', 'n']) t[k] += r[k]
    if (r.kind !== 'main') t.agents++
  }
  const group = (key, f = r => r[key]) => {
    const m = new Map()
    for (const r of rs) {
      const k = f(r)
      if (k == null || k === '') continue
      const g = m.get(k) ?? { key: k, cost: 0, tokens: 0, in: 0, out: 0, cr: 0, cw: 0, n: 0, durs: [], costs: [], toks: [] }
      g.cost += r.cost
      g.tokens += r.in + r.out + r.cr + r.cw
      for (const x of ['in', 'out', 'cr', 'cw']) g[x] += r[x]
      g.toks.push(r.in + r.out + r.cr + r.cw)
      g.n++
      if (r.end > r.start && r.start) g.durs.push(r.end - r.start)
      g.costs.push(r.cost)
      m.set(k, g)
    }
    return [...m.values()]
      .map(({ durs, costs, toks, ...g }) => ({ ...g, medDur: median(durs), medCost: median(costs), medTok: median(toks), cacheHit: g.in + g.cr + g.cw ? g.cr / (g.in + g.cr + g.cw) : 0 }))
      .sort((a, b) => b.cost - a.cost)
  }
  const first = rs.reduce((m, r) => Math.min(m, r.start || now), now)
  const span = days > 0 ? days : Math.max(1, Math.ceil((now - first) / DAY) + 1)
  const byDay = []
  const dayCost = new Map()
  for (const r of rs) {
    const d = dayOf(r.start || r.end, tz)
    const e = dayCost.get(d) ?? { cost: 0, tok: 0, byClass: {}, byClassTok: {} }
    const tk = r.in + r.out + r.cr + r.cw
    e.cost += r.cost
    e.tok += tk
    e.byClass[r.cls] = (e.byClass[r.cls] ?? 0) + r.cost
    e.byClassTok[r.cls] = (e.byClassTok[r.cls] ?? 0) + tk
    dayCost.set(d, e)
  }
  for (let i = Math.min(span, 90) - 1; i >= 0; i--) {
    const d = dayOf(now - i * DAY, tz)
    byDay.push({ day: d, ...(dayCost.get(d) ?? { cost: 0, tok: 0, byClass: {}, byClassTok: {} }) })
  }
  const heat = []
  const allDay = new Map()
  for (const r of allRows) {
    if (repo && r.repo !== repo) continue
    const d = dayOf(r.start || r.end, tz)
    const e = allDay.get(d) ?? allDay.set(d, { cost: 0, tok: 0 }).get(d)
    e.cost += r.cost
    e.tok += r.in + r.out + r.cr + r.cw
  }
  for (let i = 83; i >= 0; i--) {
    const d = dayOf(now - i * DAY, tz)
    heat.push({ day: d, ...(allDay.get(d) ?? { cost: 0, tok: 0 }) })
  }
  // Graphify etkisi: grafı kullanan agent'larla kullanmayanların ortalama giriş tokeni ve maliyeti
  const agents = rs.filter(r => r.kind !== 'main')
  const side = list => ({
    n: list.length,
    avgIn: list.length ? list.reduce((s, r) => s + r.in + r.cr + r.cw, 0) / list.length : 0,
    avgCost: list.length ? list.reduce((s, r) => s + r.cost, 0) / list.length : 0,
    avgReads: list.length ? list.reduce((s, r) => s + r.r, 0) / list.length : 0,
  })
  const graphify = {
    calls: rs.reduce((s, r) => s + r.g, 0),
    reads: rs.reduce((s, r) => s + r.r, 0),
    with: side(agents.filter(r => r.g > 0)),
    without: side(agents.filter(r => r.g === 0)),
  }
  // sınıf bazında graf karnesi: aynı tür işte grafı kullanan ve kullanmayanların ortanca bağlam tokeni
  const ctx = r => r.in + r.cr + r.cw
  graphify.byClass = [...new Set(agents.map(r => r.cls))].map(cls => {
    const xs = agents.filter(r => r.cls === cls)
    const w = xs.filter(r => r.g > 0), wo = xs.filter(r => r.g === 0)
    // eski (serisiz) satırların zirvesi 0'dır: ortancaya katılmaz
    const pk = xs => median(xs.map(r => r.peak).filter(p => p > 0))
    return { cls, with: { n: w.length, med: median(w.map(ctx)), peak: pk(w) }, without: { n: wo.length, med: median(wo.map(ctx)), peak: pk(wo) } }
  }).filter(x => x.with.n + x.without.n > 0).sort((a, b) => b.with.n + b.without.n - (a.with.n + a.without.n))
  const top = [...agents].sort((a, b) => b.cost - a.cost).slice(0, 12)
  const tok = r => r.in + r.out + r.cr + r.cw
  const topTok = [...agents].sort((a, b) => tok(b) - tok(a)).slice(0, 12)
  // cache verimliliği: yazıp geri okumayan (cache write pahalı, okunmazsa boşa) agent'lar
  const cacheWaste = agents.filter(r => r.cw >= 20000 && r.cr < r.cw).sort((a, b) => b.cw - b.cr - (a.cw - a.cr)).slice(0, 10)
  // bağlamı kim şişirdi: araç adına göre toplam ve en büyük tek sıçramalar
  const bt = new Map() // Map: araç adı "constructor" gibi olsa da güvenli
  for (const r of rs) for (const [k, d] of Object.entries(r.bt ?? {})) {
    if (!Number.isFinite(d)) continue
    const e = bt.get(k) ?? bt.set(k, { tool: k, tok: 0, agents: 0 }).get(k)
    e.tok += d
    e.agents++
  }
  const bloat = {
    byTool: [...bt.values()].sort((a, b) => b.tok - a.tok).slice(0, 12),
    jumps: rs.flatMap(r => (r.jumps ?? []).map(j => ({ ...j, sid: r.sid, id: r.id, label: r.label, cls: r.cls, repo: r.repo }))).sort((a, b) => b.d - a.d).slice(0, 15),
  }
  const workflows = group('run', r => (r.kind === 'wf' ? r.run : null)).map(g => ({
    ...g,
    runs: new Set(rs.filter(r => r.run === g.key).map(r => r.runId)).size,
  }))
  // Deneyler: etiketli session'lar (ör. grafli / grafsiz) session bazında toplanıp etiket başına ortancalanır
  const bySess = new Map()
  for (const r of rs) {
    if (!r.tag) continue
    const e = bySess.get(r.sid) ?? bySess.set(r.sid, { sid: r.sid, tag: r.tag, tok: 0, in: 0, out: 0, cr: 0, cw: 0, n: 0, agents: 0, main: 0, g: 0, r: 0, peak: 0, start: r.start || r.end }).get(r.sid)
    const tk = r.in + r.out + r.cr + r.cw
    e.tok += tk
    for (const k of ['in', 'out', 'cr', 'cw', 'n', 'g', 'r']) e[k] += r[k]
    if (r.kind === 'main') e.main += tk
    else e.agents++
    e.peak = Math.max(e.peak, r.peak ?? 0)
  }
  const experiments = [...new Set([...bySess.values()].map(x => x.tag))].map(tag => {
    const xs = [...bySess.values()].filter(x => x.tag === tag)
    const med = f => median(xs.map(f))
    return {
      tag, sessions: xs.length, tok: med(x => x.tok), cw: med(x => x.cw), out: med(x => x.out), cr: med(x => x.cr), n: med(x => x.n),
      agents: med(x => x.agents), peak: med(x => x.peak), mainShare: med(x => (x.tok ? x.main / x.tok : 0)), graph: med(x => (x.g + x.r ? x.g / (x.g + x.r) : 0)),
      list: xs.sort((a, b) => b.start - a.start).slice(0, 20).map(({ sid, tok, n, agents }) => ({ sid, tok, n, agents })),
    }
  }).sort((a, b) => a.tag.localeCompare(b.tag))
  return {
    experiments,
    range: { days, repo, from, now, tz },
    totals: { ...t, cacheHit: t.in + t.cr + t.cw ? t.cr / (t.in + t.cr + t.cw) : 0 },
    byDay, heat,
    byClass: group('cls'), byModel: group('model'), byRepo: group('repo'), workflows,
    top, topTok, cacheWaste, bloat, graphify,
    repos: [...new Set(allRows.map(r => r.repo).filter(Boolean))].sort(),
    prices: PRICES,
  }
}

// Aynı adlı workflow'un run'ları (karşılaştırma için): en yeni 30, agent satırlarıyla
export function runsOf(allRows, name) {
  const m = new Map()
  for (const r of allRows) {
    if (r.kind !== 'wf' || r.run !== name) continue
    const e = m.get(r.runId) ?? m.set(r.runId, { runId: r.runId, sid: r.sid, repo: r.repo, startedAt: Infinity, in: 0, out: 0, cr: 0, cw: 0, cost: 0, agents: [] }).get(r.runId)
    e.startedAt = Math.min(e.startedAt, r.start || Infinity)
    for (const k of ['in', 'out', 'cr', 'cw', 'cost']) e[k] += r[k]
    e.agents.push({ id: r.id, label: r.label, phase: r.phase ?? '', round: r.round ?? 1, cls: r.cls, status: r.status, in: r.in, out: r.out, cr: r.cr, cw: r.cw, cost: r.cost, peak: r.peak ?? 0, g: r.g })
  }
  return [...m.values()].map(e => ({ ...e, startedAt: Number.isFinite(e.startedAt) ? e.startedAt : 0 })).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30)
}

const CSV_COLS = ['sid', 'repo', 'tag', 'kind', 'run', 'phase', 'id', 'label', 'cls', 'agentType', 'model', 'status', 'start', 'end', 'in', 'out', 'cr', 'cw', 'base', 'peak', 'n', 'cost', 'g', 'r']
// Hücre başındaki = + - @ formül olarak çalışmasın (CSV enjeksiyonu)
const cell = v => {
  let s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function csv(rs) {
  const lines = [CSV_COLS.join(',')]
  for (const r of rs) lines.push(CSV_COLS.map(k => cell(k === 'start' || k === 'end' ? (r[k] ? new Date(r[k]).toISOString() : '') : r[k])).join(','))
  return lines.join('\n') + '\n'
}

// ---- depo ----

export function createStore({ dataDir, prices = PRICES, log = () => {} } = {}) {
  const index = new Map() // id -> { summary, rows }
  const cache = new Map() // id -> rec (LRU, en yeni sonda)
  const dirty = new Set()
  const dir = dataDir ? join(dataDir, 'sessions') : null
  const fileOf = id => join(dir, createHash('sha256').update(id).digest('hex').slice(0, 40) + '.json')

  if (dir) {
    mkdirSync(dir, { recursive: true })
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const rec = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        if (typeof rec?.id !== 'string') continue
        const v = view(rec, prices)
        index.set(rec.id, { summary: summary(v), rows: rows(v) })
      } catch (e) {
        log(`kayıt okunamadı: ${name}: ${e.message}`)
      }
    }
  }

  function touch(rec) {
    cache.delete(rec.id)
    cache.set(rec.id, rec)
    while (cache.size > DETAIL_CACHE) {
      const old = cache.keys().next().value
      if (dirty.has(old)) flushOne(old)
      cache.delete(old)
    }
  }

  function load(id) {
    if (cache.has(id)) return cache.get(id)
    if (!dir || !index.has(id)) return null
    try {
      const rec = JSON.parse(readFileSync(fileOf(id), 'utf8'))
      touch(rec)
      return rec
    } catch {
      return null
    }
  }

  function flushOne(id) {
    const rec = cache.get(id)
    dirty.delete(id)
    if (!dir || !rec) return
    const f = fileOf(id)
    writeFileSync(f + '.tmp', JSON.stringify(rec))
    renameSync(f + '.tmp', f)
  }

  return {
    // push'u birleştirir; { view, prev, summary, patch } döner ya da bayatsa null
    ingest(body, receivedAt) {
      const id = body.session.id
      const prev = load(id)
      const epoch = String(num(body.epoch))
      if (prev && prev.lastEpoch === epoch && Number.isFinite(body.sentAt) && body.sentAt < prev.sentAt) return null
      const before = prev ? view(prev, prices) : null
      const rec = merge(prev ? structuredClone(prev) : null, body, receivedAt)
      JSON.stringify(rec) // derin iç içe vb. burada patlasın, kayda girmeden
      touch(rec)
      dirty.add(id)
      const v = view(rec, prices)
      const s = summary(v)
      index.set(id, { summary: s, rows: rows(v) })
      const pushed = new Set((body.subs ?? []).map(x => x.id))
      const pushedRuns = new Set(body.runs.map(x => x.taskId))
      const patch = {
        main: v.main, misc: v.misc, totals: v.totals, ...(body.art !== undefined && { art: v.art }), receivedAt: v.receivedAt, sentAt: v.sentAt, repo: v.repo,
        subs: v.subs.filter(x => pushed.has(x.id)),
        runs: v.runs.filter(x => pushedRuns.has(x.taskId)),
      }
      return { view: v, prev: before, summary: s, patch }
    },
    get: id => {
      const rec = load(id)
      return rec ? view(rec, prices) : null
    },
    list: () => [...index.values()].map(e => e.summary).sort((a, b) => b.receivedAt - a.receivedAt),
    live: (t, max = 5) =>
      [...index.values()]
        .map(e => e.summary)
        .filter(s => t - s.receivedAt < LIVE_MS * 10)
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .slice(0, max)
        .map(s => view(load(s.id), prices)),
    rows: () => [...index.values()].flatMap(e => e.rows),
    stats: opts => stats([...index.values()].flatMap(e => e.rows), opts),
    flush() {
      for (const id of [...dirty]) {
        try {
          flushOne(id)
        } catch (e) {
          log(`yazılamadı: ${id}: ${e.message}`)
        }
      }
    },
    size: () => index.size,
  }
}
