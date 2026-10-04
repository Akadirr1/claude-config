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
  rec.receivedAt = receivedAt
  rec.sentAt = Number.isFinite(body.sentAt) ? body.sentAt : receivedAt
  const epoch = String(num(body.epoch))
  rec.lastEpoch = epoch
  if (isObj(body.main)) rec.mains[epoch] = body.main
  if (isObj(body.misc)) rec.misc[epoch] = body.misc
  for (const map of [rec.mains, rec.misc]) {
    const keys = Object.keys(map)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_EPOCHS))) delete map[k]
  }
  for (const s of body.subs ?? []) rec.subs[s.id] = s
  for (const r of body.runs) rec.runs[r.taskId] = r
  cap(rec.subs, MAX_SUBS, s => num(s.startedAt))
  cap(rec.runs, MAX_RUNS, r => num(r.startedAt))
  return rec
}

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
  return { id: rec.id, repo: rec.repo, branch: rec.branch, firstAt: rec.firstAt, receivedAt: rec.receivedAt, sentAt: rec.sentAt, main, subs, runs, misc, totals: totals(main, subs, runs, misc) }
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

// Defter satırları: analiz ve CSV dışa aktarımı bunlardan yapılır (her agent bir satır)
export function rows(v) {
  const out = []
  const row = (kind, a, extra = {}) => {
    const t = a.tokens
    out.push({
      sid: v.id, repo: v.repo, kind, id: a.id ?? 'main', label: str(a.label, 120) || (kind === 'main' ? 'Şef' : '?'), cls: a.cls,
      agentType: str(a.agentType, 80), model: a.model ?? '', status: a.status ?? '', start: num(a.startedAt), end: num(a.endedAt),
      in: t.in, out: t.out, cr: t.cr, cw: t.cw, n: t.n, cost: t.cost, g: num(a.graph?.g), r: num(a.graph?.r), ...extra,
    })
  }
  if (v.main) row('main', v.main, { start: v.firstAt, end: v.receivedAt, status: v.main.status ?? '' })
  for (const s of v.subs) row('sub', s)
  for (const r of v.runs) for (const a of r.agents) row('wf', a, { run: str(r.name, 120), runId: r.taskId })
  return out
}

export function summary(v) {
  return {
    id: v.id, repo: v.repo, branch: v.branch, firstAt: v.firstAt, receivedAt: v.receivedAt,
    title: str(v.main?.goal, 160), model: v.main?.model ?? null, status: v.main?.status ?? null,
    live: running(v), totals: { ...v.totals, byModel: undefined },
    runs: v.runs.map(r => ({ taskId: r.taskId, name: str(r.name, 120), status: r.status, startedAt: r.startedAt, endedAt: r.endedAt })),
    subs: v.subs.length,
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
      const g = m.get(k) ?? { key: k, cost: 0, tokens: 0, n: 0, durs: [], costs: [] }
      g.cost += r.cost
      g.tokens += r.in + r.out + r.cr + r.cw
      g.n++
      if (r.end > r.start && r.start) g.durs.push(r.end - r.start)
      g.costs.push(r.cost)
      m.set(k, g)
    }
    return [...m.values()]
      .map(({ durs, costs, ...g }) => ({ ...g, medDur: median(durs), medCost: median(costs) }))
      .sort((a, b) => b.cost - a.cost)
  }
  const first = rs.reduce((m, r) => Math.min(m, r.start || now), now)
  const span = days > 0 ? days : Math.max(1, Math.ceil((now - first) / DAY) + 1)
  const byDay = []
  const dayCost = new Map()
  for (const r of rs) {
    const d = dayOf(r.start || r.end, tz)
    const e = dayCost.get(d) ?? { cost: 0, byClass: {} }
    e.cost += r.cost
    e.byClass[r.cls] = (e.byClass[r.cls] ?? 0) + r.cost
    dayCost.set(d, e)
  }
  for (let i = Math.min(span, 90) - 1; i >= 0; i--) {
    const d = dayOf(now - i * DAY, tz)
    byDay.push({ day: d, ...(dayCost.get(d) ?? { cost: 0, byClass: {} }) })
  }
  const heat = []
  const allDay = new Map()
  for (const r of allRows) {
    if (repo && r.repo !== repo) continue
    const d = dayOf(r.start || r.end, tz)
    allDay.set(d, (allDay.get(d) ?? 0) + r.cost)
  }
  for (let i = 83; i >= 0; i--) {
    const d = dayOf(now - i * DAY, tz)
    heat.push({ day: d, cost: allDay.get(d) ?? 0 })
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
  const top = [...agents].sort((a, b) => b.cost - a.cost).slice(0, 12)
  const workflows = group('run', r => (r.kind === 'wf' ? r.run : null)).map(g => ({
    ...g,
    runs: new Set(rs.filter(r => r.run === g.key).map(r => r.runId)).size,
  }))
  return {
    range: { days, repo, from, now, tz },
    totals: { ...t, cacheHit: t.in + t.cr + t.cw ? t.cr / (t.in + t.cr + t.cw) : 0 },
    byDay, heat,
    byClass: group('cls'), byModel: group('model'), byRepo: group('repo'), workflows,
    top, graphify,
    repos: [...new Set(allRows.map(r => r.repo).filter(Boolean))].sort(),
    prices: PRICES,
  }
}

const CSV_COLS = ['sid', 'repo', 'kind', 'run', 'id', 'label', 'cls', 'agentType', 'model', 'status', 'start', 'end', 'in', 'out', 'cr', 'cw', 'n', 'cost', 'g', 'r']
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
    // push'u birleştirir; { view, summary, patch } döner ya da bayatsa null
    ingest(body, receivedAt) {
      const id = body.session.id
      const prev = load(id)
      const epoch = String(num(body.epoch))
      if (prev && prev.lastEpoch === epoch && Number.isFinite(body.sentAt) && body.sentAt < prev.sentAt) return null
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
        main: v.main, misc: v.misc, totals: v.totals, receivedAt: v.receivedAt, sentAt: v.sentAt, repo: v.repo,
        subs: v.subs.filter(x => pushed.has(x.id)),
        runs: v.runs.filter(x => pushedRuns.has(x.taskId)),
      }
      return { view: v, summary: s, patch }
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
