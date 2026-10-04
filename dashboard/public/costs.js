// Maliyet görünümü: kalıcı defterden analiz. Aralık + repo filtresi tek satırda; KPI'lar, günlük yığılmış
// sütun (sınıfa göre), sınıf ve model kırılımı, graphify etkisi, en pahalı agent'lar, workflow'lar, ısı haritası.
import { $, h, s, put, glyph, className, fmtCost, fmtTok, fmtPct, fmtDur, fmtDate, model, arr, num, str, obj, clsKey, CLASS, CLASS_ORDER, pref } from './util.js'
import { S } from './state.js'

let api = { openAgent() {}, openSession() {} }
export const initCosts = a => (api = a)
const RANGES = [[1, '24 saat'], [7, '7 gün'], [30, '30 gün'], [90, '90 gün'], [0, 'tümü']]
const st = { days: Number(pref.get('days', 7)) || 7, repo: '', data: null, busy: false, err: '' }

const tz = () => -new Date().getTimezoneOffset()
async function load() {
  st.busy = true
  renderCosts()
  try {
    const q = new URLSearchParams({ days: String(st.days), repo: st.repo, tz: String(tz()) })
    const r = await fetch('/api/stats?' + q, { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 401) return void (location.href = '/login')
    st.data = r.ok ? await r.json() : null
    st.err = r.ok ? '' : `Analiz alınamadı (${r.status})`
  } catch {
    st.err = 'Analiz alınamadı (bağlantı)'
  }
  st.busy = false
  renderCosts()
}
export const refreshCosts = () => S.route === 'costs' && !st.busy && load()

function controls() {
  const d = st.data
  const repos = arr(d?.repos).map(str)
  const csv = new URLSearchParams({ days: String(st.days), repo: st.repo, tz: String(tz()) })
  return h('div', { class: 'ctl' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Zaman aralığı' }, RANGES.map(([n, label]) =>
      h('button', { type: 'button', class: 'seg-b', 'aria-pressed': String(st.days === n), onclick: () => { st.days = n; pref.set('days', String(n)); load() } }, label))),
    h('label', { class: 'pick small' }, h('span', { class: 'pick-k', text: 'Repo' }),
      h('select', { onchange: e => { st.repo = e.target.value; load() } },
        h('option', { value: '', text: 'hepsi' }), repos.map(r => h('option', { value: r, text: r, selected: r === st.repo ? true : null })))),
    h('a', { class: 'ghost link', href: '/api/export.csv?' + csv, download: 'wf-defter.csv' }, '⇩ CSV defter'),
    st.busy ? h('span', { class: 'muted small', text: 'yükleniyor…' }) : null)
}

const kpi = (k, v, sub, tip) => h('div', { class: 'kpi', tip }, h('span', { class: 'k', text: k }), h('b', { class: 'num', text: v }), sub ? h('span', { class: 'kpi-s', text: sub }) : null)

// Günlük yığılmış sütun: sınıflar sabit sırayla, segmentler arasında 2px boşluk, üstte yuvarlak uç
function dailyChart(byDay) {
  const days = arr(byDay)
  if (!days.length) return h('p', { class: 'muted', text: 'Veri yok.' })
  const W = 720, H = 220, L = 46, B = 26, T = 10
  const max = Math.max(0.01, ...days.map(d => num(d.cost) ?? 0))
  const nice = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].find(x => x * 4 >= max) ?? max / 4
  const top = nice * 4
  const bw = Math.max(3, Math.min(28, (W - L - 10) / days.length - 4))
  const step = (W - L - 10) / days.length
  const y = v => T + (H - T - B) * (1 - v / top)
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Günlük maliyet, sınıflara göre' })
  for (let i = 0; i <= 4; i++) {
    const v = nice * i
    svg.append(s('line', { x1: L, x2: W - 4, y1: y(v), y2: y(v), class: i ? 'grid-l' : 'base-l' }),
      s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ax', text: fmtCost(v) }))
  }
  const every = Math.ceil(days.length / 10)
  days.forEach((d, i) => {
    const x = L + 6 + i * step + (step - bw) / 2
    let acc = 0
    const by = obj(d.byClass)
    const segs = CLASS_ORDER.filter(c => (num(by[c]) ?? 0) > 0)
    segs.forEach((c, j) => {
      const v = num(by[c])
      const y0 = y(acc), y1 = y(acc + v)
      const hgt = Math.max(0.5, y0 - y1 - (j < segs.length - 1 ? 2 : 0))
      const last = j === segs.length - 1
      svg.append(s('path', {
        d: last ? roundTop(x, y1, bw, hgt, Math.min(4, bw / 2, hgt)) : `M${x},${y1} h${bw} v${hgt} h${-bw} Z`,
        class: `bar c-${c}`, tip: `${fmtDate(Date.parse(d.day))} · ${className(c)}: ${fmtCost(v)}`,
      }))
      acc += v
    })
    // boş günde de üzerine gelinebilsin
    svg.append(s('rect', { x: x - 2, y: T, width: bw + 4, height: H - T - B, class: 'hit', tip: `${fmtDate(Date.parse(d.day))}: ${fmtCost(d.cost)}` }))
    if (i % every === 0 || i === days.length - 1)
      svg.append(s('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'ax', text: str(d.day).slice(5).replace('-', '.') }))
  })
  return svg
}
const roundTop = (x, y, w, hgt, r) => `M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt} Z`

function classBars(byClass) {
  const xs = arr(byClass)
  if (!xs.length) return h('p', { class: 'muted', text: 'Veri yok.' })
  const max = Math.max(1e-9, ...xs.map(c => num(c.cost) ?? 0))
  return h('ul', { class: 'hbars' }, xs.map(c => {
    const k = clsKey(c.key)
    return h('li', { tip: `${className(k)}: ${fmtCost(c.cost)} · ${c.n} agent · ortanca süre ${fmtDur(c.medDur)} · ortanca ${fmtCost(c.medCost)}` },
      h('span', { class: 'hb-k' }, glyph(k, 16), h('span', { text: className(k) })),
      h('span', { class: 'hb-bar' }, h('span', { class: `hb-fill c-${k}`, style: `width:${((num(c.cost) ?? 0) / max) * 100}%` })),
      h('span', { class: 'hb-v num', text: fmtCost(c.cost) }),
      h('span', { class: 'hb-n num muted', text: `${c.n}` }))
  }))
}
function plainBars(list, label) {
  const xs = arr(list).slice(0, 8)
  if (!xs.length) return h('p', { class: 'muted', text: 'Veri yok.' })
  const max = Math.max(1e-9, ...xs.map(c => num(c.cost) ?? 0))
  return h('ul', { class: 'hbars' }, xs.map(c => h('li', { tip: `${label(c.key)}: ${fmtCost(c.cost)} · ${fmtTok(c.tokens)} token` },
    h('span', { class: 'hb-k' }, h('span', { text: label(c.key) })),
    h('span', { class: 'hb-bar' }, h('span', { class: 'hb-fill neutral', style: `width:${((num(c.cost) ?? 0) / max) * 100}%` })),
    h('span', { class: 'hb-v num', text: fmtCost(c.cost) }),
    h('span', { class: 'hb-n num muted', text: fmtTok(c.tokens) }))))
}

// Graphify etkisi: grafı kullanan agent'lar codebase'i daha az mı okuyor, daha mı ucuz?
function graphImpact(g) {
  const w = obj(g?.with), wo = obj(g?.without)
  const n = (num(w.n) ?? 0) + (num(wo.n) ?? 0)
  if (!n) return h('p', { class: 'muted', text: 'Veri yok.' })
  const dIn = wo.avgIn ? 1 - (num(w.avgIn) ?? 0) / wo.avgIn : 0
  const dCost = wo.avgCost ? 1 - (num(w.avgCost) ?? 0) / wo.avgCost : 0
  const side = (title, x, cls) => h('div', { class: `gi-side ${cls}` },
    h('span', { class: 'k', text: title }),
    h('b', { class: 'num', text: `${x.n ?? 0} agent` }),
    h('span', { class: 'muted small', text: `ort. giriş ${fmtTok(x.avgIn)} · ort. ${fmtCost(x.avgCost)}` }))
  const rel = d => (Math.round(d * 100) >= 0 ? `%${Math.round(d * 100)} daha az` : `%${Math.round(-d * 100)} daha fazla`)
  const verdict = !w.n || !wo.n ? 'Karşılaştırma için iki tarafta da agent gerekli.'
    : `Grafı kullanan agent ortalamada ${rel(dIn)} giriş tokeni ve ${rel(dCost)} maliyetle çalışmış${dIn <= 0 ? ' — bu aralıkta tasarruf görünmüyor, görev karışımına bak' : ''}.`
  return h('div', { class: 'gi' },
    h('div', { class: 'gi-row' }, side('◈ graphify kullanan', w, 'with'), side('dosya tarayan', wo, 'without')),
    h('p', { class: 'gi-verdict', text: verdict }),
    h('p', { class: 'muted small', text: `${num(g.calls) ?? 0} graphify çağrısı · ${num(g.reads) ?? 0} Read/Grep/Glob · graf-önce oranı ${fmtPct((num(w.n) ?? 0) / n)}` }))
}

function topAgents(list) {
  const xs = arr(list)
  if (!xs.length) return h('p', { class: 'muted', text: 'Veri yok.' })
  return h('div', { class: 'tbl-w' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['agent', 'repo', 'model', 'token', 'maliyet'].map(x => h('th', { scope: 'col', text: x })))),
    h('tbody', {}, xs.map(r => h('tr', { tabindex: '0', class: 'clickable', onclick: () => api.openAgent(str(r.sid), str(r.id)), onkeydown: e => e.key === 'Enter' && api.openAgent(str(r.sid), str(r.id)) },
      h('td', {}, h('span', { class: 'cell-a' }, glyph(clsKey(r.cls), 16), h('span', { text: str(r.label) }))),
      h('td', { class: 'muted', text: str(r.repo) }),
      h('td', { class: 'mono', text: model(str(r.model)) }),
      h('td', { class: 'num', text: fmtTok((num(r.in) ?? 0) + (num(r.out) ?? 0) + (num(r.cr) ?? 0) + (num(r.cw) ?? 0)) }),
      h('td', { class: 'num strong', text: fmtCost(r.cost) }))))))
}

function workflows(list) {
  const xs = arr(list)
  if (!xs.length) return h('p', { class: 'muted', text: 'Bu aralıkta workflow yok.' })
  return h('div', { class: 'tbl-w' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['workflow', 'run', 'agent', 'toplam', 'run başı', 'ort. agent süresi'].map(x => h('th', { scope: 'col', text: x })))),
    h('tbody', {}, xs.map(w => h('tr', {},
      h('td', { class: 'mono strong', text: str(w.key) }),
      h('td', { class: 'num', text: String(num(w.runs) ?? 0) }),
      h('td', { class: 'num', text: String(num(w.n) ?? 0) }),
      h('td', { class: 'num', text: fmtCost(w.cost) }),
      h('td', { class: 'num strong', text: fmtCost((num(w.cost) ?? 0) / Math.max(1, num(w.runs) ?? 1)) }),
      h('td', { class: 'num', text: fmtDur(num(w.medDur) ?? 0) }))))))
}

// 12 haftalık ısı haritası: tek ton, açıktan koyuya (sıralı)
function heatmap(heat) {
  const xs = arr(heat)
  if (!xs.length) return null
  const max = Math.max(1e-9, ...xs.map(d => num(d.cost) ?? 0))
  const first = new Date(Date.parse(xs[0].day))
  const offset = (first.getUTCDay() + 6) % 7 // pazartesi başlangıçlı
  const cells = Array.from({ length: offset }, () => null).concat(xs)
  const weeks = Math.ceil(cells.length / 7)
  const svg = s('svg', { class: 'heat', viewBox: `0 0 ${weeks * 14 + 26} ${7 * 14 + 4}`, role: 'img', 'aria-label': 'Son 12 haftanın günlük maliyet ısı haritası' })
  ;['Pt', '', 'Ça', '', 'Cu', '', 'Pz'].forEach((d, i) => d && svg.append(s('text', { x: 0, y: i * 14 + 11, class: 'ax', text: d })))
  cells.forEach((d, i) => {
    if (!d) return
    const v = (num(d.cost) ?? 0) / max
    const lvl = v === 0 ? 0 : v < 0.25 ? 1 : v < 0.5 ? 2 : v < 0.75 ? 3 : 4
    svg.append(s('rect', { x: 24 + Math.floor(i / 7) * 14, y: (i % 7) * 14 + 2, width: 11, height: 11, rx: 2.5, class: `hm l${lvl}`, tip: `${fmtDate(Date.parse(d.day))}: ${fmtCost(d.cost)}` }))
  })
  return h('div', { class: 'heat-w' }, svg,
    h('div', { class: 'heat-lg', 'aria-hidden': 'true' }, h('span', { class: 'muted small', text: 'az' }), [0, 1, 2, 3, 4].map(l => h('i', { class: `hm-k l${l}` })), h('span', { class: 'muted small', text: 'çok' })))
}

const panel = (title, hint, body, cls = '') => h('section', { class: `panel ${cls}` }, h('div', { class: 'phead' }, h('h2', { text: title }), hint ? h('span', { class: 'phint', text: hint }) : null), h('div', { class: 'pbody' }, body))

function legend(byDay) {
  const used = new Set(arr(byDay).flatMap(d => Object.keys(obj(d.byClass))))
  return h('div', { class: 'legend' }, CLASS_ORDER.filter(c => used.has(c)).map(c => h('span', { class: `lg c-${c}` }, glyph(c, 14), CLASS[c].name)))
}

export function renderCosts() {
  const box = $('view-costs')
  const d = st.data
  if (!d && !st.busy && !st.err) return void load()
  const t = obj(d?.totals)
  const perSession = (num(t.sessions) ?? 0) ? (num(t.cost) ?? 0) / t.sessions : 0
  put(box,
    h('div', { class: 'costs-head' }, h('h1', { class: 'v-title', text: 'Maliyet ve token' }), h('p', { class: 'muted', text: 'API liste fiyatıyla karşılık; Claude Code aboneliğinde gerçek fatura farklıdır.' }), controls()),
    st.err ? h('p', { class: 'err', text: st.err }) : null,
    d ? h('div', { class: 'kpis' },
      kpi('toplam maliyet', fmtCost(t.cost), `${num(t.sessions) ?? 0} session · ${num(t.agents) ?? 0} agent`),
      kpi('token', fmtTok((t.in ?? 0) + (t.out ?? 0) + (t.cr ?? 0) + (t.cw ?? 0)), `çıkış ${fmtTok(t.out)} · ${num(t.n) ?? 0} istek`),
      kpi('cache isabeti', fmtPct(t.cacheHit), `okunan ${fmtTok(t.cr)}`, 'cache okumanın toplam girişe oranı'),
      kpi('session başı', fmtCost(perSession)),
      kpi('graf-önce', fmtPct(obj(d.graphify).with?.n / Math.max(1, (obj(d.graphify).with?.n ?? 0) + (obj(d.graphify).without?.n ?? 0))), 'graphify kullanan agent payı')) : null,
    d ? h('div', { class: 'cgrid' },
      panel('Günlük maliyet', 'sınıflara göre', h('div', {}, legend(d.byDay), dailyChart(d.byDay)), 'span2'),
      panel('Sınıflar', 'maliyet · agent', classBars(d.byClass)),
      panel('Graphify etkisi', 'grafı kullanan vs dosya tarayan', graphImpact(d.graphify)),
      panel('Modeller', 'maliyet · token', plainBars(d.byModel, k => model(str(k)))),
      panel('Repolar', 'maliyet · token', plainBars(d.byRepo, k => str(k))),
      panel('En pahalı agent\'lar', 'tıklayınca session açılır', topAgents(d.top), 'span2'),
      panel('Workflow\'lar', 'run başına maliyet', workflows(d.workflows), 'span2'),
      panel('Ritim', 'son 12 hafta', heatmap(d.heat), 'span2')) : null)
}
