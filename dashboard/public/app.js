// wf-dashboard paneli: /feature run'larında agent'ların birbirine devrettiği işi canlı gösterir.
// Güvenlik: agent'lardan gelen her metin dışarıdan gelir. DOM yalnızca createElement(NS) + textContent
// ile kurulur; sınıf adına giren değerler (rol, durum, severity) beyaz listeden geçer.

const $ = id => document.getElementById(id)
const SVGNS = 'http://www.w3.org/2000/svg'
const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- DOM yardımcıları
function attrs(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'text') el.textContent = v
    else if (k === 'onclick') el.addEventListener('click', v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  return el
}
function h(tag, props = {}, ...kids) {
  const el = attrs(document.createElement(tag), props)
  el.append(...kids.flat().filter(k => k != null && k !== false))
  return el
}
function s(tag, props = {}, ...kids) {
  const el = attrs(document.createElementNS(SVGNS, tag), props)
  el.append(...kids.flat().filter(k => k != null && k !== false))
  return el
}

// ---------- tema (varsayılan koyu, seçim localStorage'da)
function setTheme(t, save) {
  document.documentElement.dataset.theme = t
  if (save) try { localStorage.setItem('wf-theme', t) } catch {}
  const b = $('theme')
  b.textContent = t === 'light' ? '☾ Koyu' : '☀ Açık'
  b.setAttribute('aria-label', t === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç')
}
let savedTheme = 'dark'
try { if (localStorage.getItem('wf-theme') === 'light') savedTheme = 'light' } catch {}
setTheme(savedTheme)
$('theme').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true))

// ---------- sözlükler
const ROLES = {
  ba: { name: 'BA', long: 'İş analisti (BA)', letter: 'B', shape: ['polygon', { points: '13,1 25,13 13,25 1,13' }] },
  dev: { name: 'Dev', long: 'Geliştirici', letter: 'D', shape: ['circle', { cx: 13, cy: 13, r: 12 }] },
  review: { name: 'Review', long: 'Reviewer', letter: 'R', shape: ['rect', { x: 2, y: 2, width: 22, height: 22, rx: 4 }] },
  qa: { name: 'QA', long: 'QA', letter: 'Q', ty: 20.5, shape: ['polygon', { points: '13,1.5 25.5,24.5 0.5,24.5' }] },
  other: { name: 'Diğer', long: 'Diğer', letter: '•', shape: ['polygon', { points: '13,1 24,7 24,19 13,25 2,19 2,7' }] },
}
const STATUS = {
  running: { t: 'çalışıyor', i: '●' },
  done: { t: 'bitti', i: '✓' },
  failed: { t: 'hata', i: '✕' },
  stopped: { t: 'durduruldu', i: '■' },
}
const RUN_STATUS = { running: 'sürüyor', done: 'tamamlandı', failed: 'başarısız', stopped: 'durduruldu' }
const SEVERITY = { Critical: 'critical', Important: 'important', Minor: 'minor' }
const roleKey = r => (Object.hasOwn(ROLES, r) ? r : 'other')
const stKey = x => (Object.hasOwn(STATUS, x) ? x : 'stopped')

// ---------- biçimlendirme
const pad = n => String(n).padStart(2, '0')
function fmtDur(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(sec / 60), hr = Math.floor(m / 60)
  return hr ? `${hr}sa ${pad(m % 60)}dk` : m ? `${m}dk ${pad(sec % 60)}sn` : `${sec}sn`
}
const fmtClock = t => (Number.isFinite(t) ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--')
const fmtShort = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const fmtOff = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}` }
function fmtAgo(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return sec < 5 ? 'az önce' : sec < 60 ? `${sec} sn önce` : sec < 3600 ? `${Math.floor(sec / 60)} dk önce` : `${Math.floor(sec / 3600)} sa önce`
}

// ---------- gelen veriyi düzle (şekil bozuksa kırılmasın)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const arr = v => (Array.isArray(v) ? v : [])
const str = v => (v == null ? '' : String(v))
function normRun(r) {
  const startedAt = num(r.startedAt) ?? 0
  return {
    taskId: str(r.taskId),
    name: str(r.name) || 'workflow',
    status: stKey(r.status),
    startedAt,
    endedAt: num(r.endedAt),
    phases: arr(r.phases).map(str),
    agents: arr(r.agents).filter(a => a && a.id != null).map(a => ({
      id: str(a.id),
      label: str(a.label) || str(a.id),
      phase: a.phase == null ? null : str(a.phase),
      round: Math.min(50, Math.max(1, Math.floor(num(a.round) ?? 1))),
      role: roleKey(a.role),
      status: stKey(a.status),
      startedAt: num(a.startedAt) ?? startedAt,
      endedAt: num(a.endedAt),
      steps: arr(a.steps).filter(x => x && typeof x === 'object').map(x => ({ t: num(x.t), text: str(x.text) })),
      result: a.result && typeof a.result === 'object' ? a.result : null,
    })),
    edges: arr(r.edges).filter(e => e && e.from != null && e.to != null)
      .map(e => ({ from: str(e.from), to: str(e.to), kind: e.kind === 'loop' ? 'loop' : 'handoff' })),
  }
}
function normSession(x) {
  const receivedAt = num(x.receivedAt) ?? Date.now()
  return { id: str(x.id), repo: str(x.repo), receivedAt, sentAt: num(x.sentAt) ?? receivedAt, runs: arr(x.runs).filter(r => r && r.taskId != null).map(normRun) }
}

// ---------- durum
const S = {
  sessions: new Map(),
  off: 0, // sunucu saati − tarayıcı saati
  sid: null, tid: null, pinned: false,
  agentId: null,
  filters: { handoff: true, end: true, error: true },
  logs: new Map(), // "sid|taskId" -> Map(olay anahtarı -> olay)
  seen: new Set(), // animasyonu oynamış kenar/düğüm anahtarları
  shown: null, // son çizilen run anahtarı
  live: [], // saniyede bir çalışan güncelleyiciler
  redraw: null,
  rounds: 0,
}
const serverNow = () => Date.now() + S.off
const modNow = sess => serverNow() - (sess.receivedAt - sess.sentAt)
const runKey = (sid, tid) => `${sid}|${tid}`
const lastStepT = a => a.steps.reduce((m, x) => (x.t != null && x.t > m ? x.t : m), a.startedAt)
const agentEnd = (a, r, sess) => a.endedAt ?? (a.status === 'running' ? modNow(sess) : r.endedAt ?? lastStepT(a))
const runEnd = (r, sess) => r.endedAt ?? (r.status === 'running' ? modNow(sess) : Math.max(r.startedAt, ...r.agents.map(a => agentEnd(a, r, sess))))
const newest = sess => sess.runs.reduce((m, r) => (!m || r.startedAt > m.startedAt ? r : m), null)
function current() {
  const sess = S.sessions.get(S.sid)
  return { sess, run: sess?.runs.find(r => r.taskId === S.tid) }
}

// Olaylar ardışık snapshot'ların farkından türetilir; anahtar aynı olayı iki kez yazmaz.
function logDiff(sid, prev, run) {
  const key = runKey(sid, run.taskId)
  let log = S.logs.get(key)
  if (!log) S.logs.set(key, (log = new Map()))
  const add = (k, ev) => { if (!log.has(k)) log.set(k, ev) }
  const byId = new Map(run.agents.map(a => [a.id, a]))
  const was = new Map((prev?.agents ?? []).map(a => [a.id, a]))
  const hadEdge = new Set((prev?.edges ?? []).map(e => `${e.from}>${e.to}`))
  for (const a of run.agents) {
    if (!was.has(a.id) && !run.edges.some(e => e.to === a.id))
      add(`s${a.id}`, { type: 'handoff', icon: '▶', t: a.startedAt, agent: a.id, text: `${a.label} başladı` })
    if (a.status !== 'running' && a.status !== was.get(a.id)?.status) {
      const text = a.status === 'done' ? `${a.label} bitti` : a.status === 'failed' ? `${a.label} hata verdi` : `${a.label} durduruldu`
      add(`e${a.id}`, { type: a.status === 'done' ? 'end' : 'error', icon: STATUS[a.status].i, t: a.endedAt ?? run.endedAt ?? lastStepT(a), agent: a.id, text })
    }
  }
  for (const e of run.edges) {
    const from = byId.get(e.from), to = byId.get(e.to)
    if (!from || !to || hadEdge.has(`${e.from}>${e.to}`)) continue
    const loop = e.kind === 'loop'
    add(`h${e.from}>${e.to}`, { type: 'handoff', icon: loop ? '↺' : '→', loop, t: to.startedAt, agent: to.id, text: `${from.label} → ${to.label}${loop ? ` (tur ${to.round})` : ''}` })
  }
  if (run.status !== 'running' && run.status !== prev?.status)
    add('run', { type: run.status === 'done' ? 'end' : 'error', icon: STATUS[run.status].i, t: run.endedAt ?? run.startedAt, text: `Run ${RUN_STATUS[run.status]}` })
}

function ingest(raw, serverNowAt) {
  if (num(serverNowAt) != null) S.off = serverNowAt - Date.now()
  const sess = normSession(raw)
  if (!sess.id) return
  const prev = new Map((S.sessions.get(sess.id)?.runs ?? []).map(r => [r.taskId, r]))
  for (const r of sess.runs) logDiff(sess.id, prev.get(r.taskId), r)
  S.sessions.set(sess.id, sess)
}

// Varsayılan: en son güncellenen session'ın en yeni run'ı. Kullanıcı seçtiyse seçim kalır.
function pickDefault() {
  const pinnedSess = S.pinned && S.sessions.get(S.sid)
  if (pinnedSess) {
    if (!pinnedSess.runs.some(r => r.taskId === S.tid)) S.tid = newest(pinnedSess)?.taskId ?? null
    return
  }
  S.pinned = false
  const latest = [...S.sessions.values()].sort((a, b) => b.receivedAt - a.receivedAt)[0]
  S.sid = latest?.id ?? null
  S.tid = latest ? newest(latest)?.taskId ?? null : null
}

// ---------- ortak parçalar
function glyph(role, size = 26) {
  const R = ROLES[role]
  const [tag, at] = R.shape
  return s('svg', { class: `glyph r-${role}`, viewBox: '0 0 26 26', width: size, height: size, 'aria-hidden': 'true' },
    s(tag, { ...at, class: 'g-shape' }),
    s('text', { x: 13, y: R.ty ?? 17.5, 'text-anchor': 'middle', class: 'g-letter', text: R.letter }))
}
const statusText = st => `${STATUS[st].i} ${STATUS[st].t}`

// ---------- seçiciler
let selSig = ''
function renderPickers() {
  const sessList = [...S.sessions.values()].sort((a, b) => b.receivedAt - a.receivedAt)
  const sess = S.sessions.get(S.sid)
  const runs = sess ? [...sess.runs].sort((a, b) => b.startedAt - a.startedAt) : []
  const sig = JSON.stringify([S.sid, S.tid, sessList.map(x => [x.id, x.repo]), runs.map(r => [r.taskId, r.status])])
  if (sig === selSig) return
  selSig = sig
  const ss = $('sess'), rs = $('run')
  ss.replaceChildren(...sessList.map(x => h('option', { value: x.id, text: `${x.repo || 'repo?'} · ${x.id.slice(-6)}` })))
  rs.replaceChildren(...runs.map(r => h('option', { value: r.taskId, text: `${r.name} · ${fmtShort(r.startedAt)} · ${STATUS[r.status].i} ${RUN_STATUS[r.status]}` })))
  ss.value = S.sid ?? ''
  rs.value = S.tid ?? ''
  ss.disabled = !sessList.length
  rs.disabled = !runs.length
}
$('sess').addEventListener('change', e => {
  const sess = S.sessions.get(e.target.value)
  if (!sess) return
  Object.assign(S, { sid: sess.id, tid: newest(sess)?.taskId ?? null, pinned: true, agentId: null })
  render()
})
$('run').addEventListener('change', e => {
  Object.assign(S, { tid: e.target.value, pinned: true, agentId: null })
  render()
})

// ---------- run özeti
function renderRunbar(sess, run) {
  const bar = $('runbar')
  if (!run) return bar.replaceChildren()
  const dur = h('b', { class: 'num' })
  S.live.push(() => { dur.textContent = fmtDur(runEnd(run, sess) - run.startedAt) })
  const stat = (k, v) => h('span', { class: 'stat' }, h('span', { class: 'k', text: k }), typeof v === 'string' ? h('b', { class: 'num', text: v }) : v)
  const rounds = Math.max(1, ...run.agents.map(a => a.round))
  bar.replaceChildren(
    h('div', { class: 'rb-title' }, h('span', { class: 'rb-name', text: run.name }), h('span', { class: 'rb-repo', text: sess.repo })),
    h('span', { class: `chip run-st s-${run.status}`, text: `${STATUS[run.status].i} ${RUN_STATUS[run.status]}` }),
    h('div', { class: 'stats' },
      stat('süre', dur),
      stat('tur', String(rounds)),
      stat('agent', String(run.agents.length)),
      stat('çalışan', String(run.agents.filter(a => a.status === 'running').length)),
      stat('başladı', fmtClock(run.startedAt))))
}

// ---------- akış grafiği: phase sütunları × tur satırları, kenarlar SVG'de devre izi gibi
function renderGraph(sess, run, animate) {
  const box = $('graph')
  S.redraw = null
  if (!run) {
    box.replaceChildren(h('div', { class: 'empty' },
      h('p', { class: 'empty-t', text: 'Henüz veri yok' }),
      h('p', { text: 'Cloud session\'da /feature başlatınca agent\'lar burada belirir.' })))
    return
  }
  const phases = run.phases.length ? [...run.phases] : [...new Set(run.agents.map(a => a.phase).filter(Boolean))]
  const cols = run.agents.some(a => !phases.includes(a.phase)) ? [...phases, 'Diğer'] : phases
  const colOf = a => { const i = phases.indexOf(a.phase); return i >= 0 ? i : cols.length - 1 }
  const rounds = Math.max(1, ...run.agents.map(a => a.round))
  // Geniş ekran: sütun = phase, satır = tur. Dar ekran (V): sütun = tur, satır = phase.
  const V = narrow.matches
  const grid = h('div', { class: V ? 'grid v' : 'grid' })
  const nCols = V ? rounds : cols.length, nRows = V ? cols.length : rounds
  grid.style.gridTemplateColumns = V ? `var(--phw) repeat(${nCols}, var(--colw))` : `var(--rhw) repeat(${nCols}, minmax(var(--colw), 1fr))`
  const place = (el, row, col) => { el.style.gridRow = row; el.style.gridColumn = col; grid.append(el); return el }
  const at = (el, phaseIdx, round) => (V ? place(el, phaseIdx + 2, round + 1) : place(el, round + 1, phaseIdx + 2))

  for (let i = 0; i < nCols; i++) place(h('div', { class: 'lane' }), `1 / span ${nRows + 1}`, i + 2)
  const phaseHeads = cols.map((p, i) => h('div', { class: 'ph' }, h('span', { class: 'ph-i', text: pad(i + 1) }), h('span', { class: 'ph-t', text: p })))
  const roundHeads = Array.from({ length: rounds }, (_, i) => h('div', { class: 'rh' }, h('span', { text: 'tur' }), h('b', { text: String(i + 1) })))
  phaseHeads.forEach((el, i) => (V ? place(el, i + 2, 1) : place(el, 1, i + 2)))
  roundHeads.forEach((el, i) => (V ? place(el, 1, i + 2) : place(el, i + 2, 1)))
  const colHeads = V ? roundHeads : phaseHeads, rowHeads = V ? phaseHeads : roundHeads
  const colIdx = a => (V ? a.round - 1 : colOf(a))

  const cells = new Map()
  const nodes = new Map()
  for (const a of run.agents) {
    const ck = `${colOf(a)}|${a.round}`
    if (!cells.has(ck)) cells.set(ck, at(h('div', { class: 'cell' }), colOf(a), a.round))
    const el = nodeEl(sess, run, a)
    nodes.set(a.id, el)
    cells.get(ck).append(el)
    const k = `n|${run.taskId}|${a.id}`
    if (animate && !S.seen.has(k) && motion()) el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' })
    S.seen.add(k)
  }

  const svg = s('svg', { class: 'edges', 'aria-hidden': 'true' })
  const canvas = h('div', { class: 'canvas' }, svg, grid)
  box.replaceChildren(canvas)
  // dar ekranda yeni run ya da yeni tur gelince en son tura kaydır
  if (V && (!animate || rounds > S.rounds)) box.scrollLeft = box.scrollWidth
  S.rounds = rounds
  let first = animate
  S.redraw = () => { drawEdges({ canvas, svg, grid, run, nodes, colHeads, rowHeads, colIdx, colOf, V }, first); first = false }
  ro.disconnect()
  ro.observe(canvas)
}
const ro = new ResizeObserver(() => S.redraw?.())
const narrow = matchMedia('(max-width: 760px)')
narrow.addEventListener('change', () => render())

function nodeEl(sess, run, a) {
  const R = ROLES[a.role]
  const dur = h('span', { class: 'n-dur num' })
  S.live.push(() => { dur.textContent = fmtDur(agentEnd(a, run, sess) - a.startedAt) })
  const last = a.status === 'running' && a.steps.length ? h('span', { class: 'n-step', text: a.steps.at(-1).text }) : null
  return h('button', {
    type: 'button',
    class: `node r-${a.role} s-${a.status}${S.agentId === a.id ? ' sel' : ''}`,
    'data-k': `n${a.id}`,
    'aria-label': `${a.label}, ${R.long}, tur ${a.round}, ${STATUS[a.status].t}`,
    'aria-expanded': S.agentId === a.id ? 'true' : 'false',
    onclick: () => openDetail(a.id),
  },
  glyph(a.role),
  h('span', { class: 'n-main' },
    h('span', { class: 'n-label', text: a.label }),
    h('span', { class: 'n-sub' }, h('span', { class: 'n-st', text: statusText(a.status) }), h('span', { class: 'n-sep', text: '·' }), dur),
    last))
}

// Köşeleri yuvarlatılmış dik çizgi
function roundPath(p, r = 9) {
  let d = `M${p[0][0]},${p[0][1]}`
  for (let i = 1; i < p.length - 1; i++) {
    const [x0, y0] = p[i - 1], [x, y] = p[i], [x1, y1] = p[i + 1]
    const d0 = Math.hypot(x - x0, y - y0), d1 = Math.hypot(x1 - x, y1 - y)
    const k = Math.min(r, d0 / 2, d1 / 2)
    if (!k) { d += ` L${x},${y}`; continue }
    d += ` L${x - ((x - x0) / d0) * k},${y - ((y - y0) / d0) * k} Q${x},${y} ${x + ((x1 - x) / d1) * k},${y + ((y1 - y) / d1) * k}`
  }
  const [lx, ly] = p[p.length - 1]
  return `${d} L${lx},${ly}`
}

function drawEdges({ canvas, svg, grid, run, nodes, colHeads, rowHeads, colIdx, colOf, V }, animate) {
  const base = canvas.getBoundingClientRect()
  const box = el => {
    const r = el.getBoundingClientRect()
    return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cy: (r.top + r.bottom) / 2 - base.top }
  }
  const cs = getComputedStyle(grid)
  const cg = parseFloat(cs.columnGap) || 40, rg = parseFloat(cs.rowGap) || 36
  const cr = colHeads.map(box), rr = rowHeads.map(box)
  const gapL = c => cr[c].l - cg / 2 // sütunun solundaki koridor
  const laneAbove = row => rr[row - 1].t - rg / 2 // satırın üstündeki koridor
  svg.setAttribute('width', canvas.scrollWidth)
  svg.setAttribute('height', canvas.scrollHeight)

  const defs = s('defs', {}, ...['ba', 'dev', 'review', 'qa', 'other', 'loop'].map(k =>
    s('marker', { id: `mk-${k}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' },
      s('path', { d: 'M0,0 L10,5 L0,10 z', class: `mk mk-${k}` }))))
  const paths = [], flows = [], tags = new Map()
  const byId = new Map(run.agents.map(a => [a.id, a]))
  run.edges.forEach((e, i) => {
    const A = byId.get(e.from), B = byId.get(e.to)
    const na = nodes.get(e.from), nb = nodes.get(e.to)
    if (!A || !B || !na || !nb) return
    const a = box(na), b = box(nb), ca = colIdx(A), cb = colIdx(B)
    // Her kenar hedefe soldaki koridordan girer. Devirler koridorun sol, geri dönüşler sağ şeridini kullanır;
    // aynı hedefe/kaynaktan gelenler üst üste biner (veri yolu gibi).
    const loop = e.kind === 'loop' || (V ? B.round <= A.round && colOf(B) <= colOf(A) : cb <= ca)
    let pts
    if (V) {
      const x = gapL(cb) + (loop ? 7 : -7)
      pts = loop ? [[a.r, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]] : [[a.l, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]]
      if (loop) tags.set(B.id, [x - 2, b.t - 8, B.round])
    } else if (!loop) {
      const gx = gapL(ca + 1) - 7
      if (cb === ca + 1) pts = [[a.r, a.cy], [gx, a.cy], [gx, b.cy], [b.l, b.cy]]
      else {
        const ly = laneAbove(Math.min(A.round, B.round)) + 8, gx2 = gapL(cb) - 7
        pts = [[a.r, a.cy], [gx, a.cy], [gx, ly], [gx2, ly], [gx2, b.cy], [b.l, b.cy]]
      }
    } else {
      // geri dönüş: kaynağın solundan çık, hedef turun üstündeki koridordan geç, hedefe soldan gir
      const sx = gapL(ca) + 7, tx = gapL(cb) + 7, ly = laneAbove(B.round) - 8
      pts = [[a.l, a.cy], [sx, a.cy], [sx, ly], [tx, ly], [tx, b.cy], [b.l, b.cy]]
      tags.set(B.id, [tx + 10, ly - 6, B.round])
    }
    const d = roundPath(pts)
    const kind = loop ? 'loop' : 'handoff'
    const path = s('path', { d, class: `edge ${kind} from-${A.role}`, 'marker-end': `url(#mk-${loop ? 'loop' : B.role})` })
    paths.push(path)
    const k = `e|${run.taskId}|${e.from}>${e.to}`
    if (animate && !S.seen.has(k) && motion()) flows.push([path, s('path', { d, class: `flow ${kind}` })])
    S.seen.add(k)
  })
  const labels = [...tags.values()].map(([x, y, round]) =>
    s('text', { x, y, class: 'loop-tag', text: `↺ tur ${round}` }))
  svg.replaceChildren(defs, ...paths, ...labels, ...flows.map(f => f[1]))

  // Yeni kenar: çizgi belirir, üstünden kısa bir ışık akar (yalnız bir kez)
  for (const [path, flow] of flows) {
    const len = flow.getTotalLength()
    flow.style.strokeDasharray = `18 ${len + 18}`
    path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' })
    flow.animate([{ strokeDashoffset: 18 }, { strokeDashoffset: -len }], { duration: 1200, easing: 'cubic-bezier(.4,0,.2,1)' }).finished
      .then(() => flow.remove(), () => flow.remove())
  }
}

// ---------- gantt
function renderGantt(sess, run) {
  const box = $('gantt')
  if (!run || !run.agents.length) return box.replaceChildren(h('p', { class: 'muted pad', text: 'Agent yok.' }))
  const axis = h('div', { class: 'g-ticks' })
  const nowLine = h('span', { class: 'g-now' })
  const bars = run.agents.map(a => {
    const bar = h('span', { class: `g-bar r-${a.role} s-${a.status}` })
    const row = h('button', {
      type: 'button', class: `g-row${S.agentId === a.id ? ' sel' : ''}`, 'data-k': `g${a.id}`,
      'aria-label': `${a.label}: ${STATUS[a.status].t}`, onclick: () => openDetail(a.id),
    },
    h('span', { class: 'g-lab' }, glyph(a.role, 18), h('span', { class: 'g-name', text: a.label })),
    h('span', { class: 'g-track' }, bar))
    return { a, bar, row }
  })
  box.replaceChildren(
    h('div', { class: 'g-axis' }, h('span', { class: 'g-lab muted', text: 'agent' }), h('span', { class: 'g-track' }, axis)),
    h('div', { class: 'g-rows' }, bars.map(x => x.row), h('span', { class: 'g-overlay' }, nowLine)))
  S.live.push(() => {
    const t0 = run.startedAt, t1 = runEnd(run, sess), span = Math.max(t1 - t0, 1000)
    const pct = t => `${(Math.min(Math.max(t - t0, 0), span) / span) * 100}%`
    for (const { a, bar } of bars) {
      const st = a.startedAt, en = agentEnd(a, run, sess)
      bar.style.left = pct(st)
      bar.style.width = `max(4px, ${((Math.max(en - st, 0)) / span) * 100}%)`
    }
    nowLine.hidden = run.status !== 'running'
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map(x => x * 1000)
    const step = steps.find(x => span / x <= 6) ?? 3600e3 * 4
    const ticks = []
    for (let t = 0; t === 0 || t <= span * 0.9; t += step) {
      const tk = h('span', { class: 'g-tick', text: fmtOff(t) })
      tk.style.left = `${(t / span) * 100}%`
      ticks.push(tk)
    }
    axis.replaceChildren(...ticks)
  })
}

// ---------- olay akışı
const FILTERS = [['handoff', 'Devirler'], ['end', 'Bitişler'], ['error', 'Hatalar']]
const filterBtns = FILTERS.map(([k, label]) => {
  const count = h('span', { class: 'f-n num' })
  const b = h('button', { type: 'button', class: `fbtn f-${k}`, 'aria-pressed': 'true', onclick: () => {
    S.filters[k] = !S.filters[k]
    b.setAttribute('aria-pressed', String(S.filters[k]))
    renderFeed(current().run)
  } }, h('span', { class: 'f-dot', 'aria-hidden': 'true' }), label, count)
  b.count = count
  return [k, b]
})
$('filters').replaceChildren(...filterBtns.map(x => x[1]))

function renderFeed(run) {
  const list = $('feed')
  const evs = run ? [...(S.logs.get(runKey(S.sid, run.taskId))?.values() ?? [])] : []
  for (const [k, b] of filterBtns) b.count.textContent = String(evs.filter(e => e.type === k).length)
  const shown = evs.filter(e => S.filters[e.type]).sort((a, b) => b.t - a.t)
  if (!shown.length) return list.replaceChildren(h('li', { class: 'muted pad', text: run ? 'Bu filtrede olay yok.' : 'Run seçilmedi.' }))
  list.replaceChildren(...shown.map(e => {
    const inner = [h('time', { class: 'num', text: fmtClock(e.t) }), h('span', { class: 'ev-i', 'aria-hidden': 'true', text: e.icon }), h('span', { class: 'ev-x', text: e.text })]
    const cls = `ev t-${e.type}${e.loop ? ' loop' : ''}`
    return h('li', { class: cls }, e.agent
      ? h('button', { type: 'button', class: 'ev-b', 'data-k': `f${e.agent}${e.text}`, onclick: () => openDetail(e.agent) }, inner)
      : h('div', { class: 'ev-b' }, inner))
  }))
}

// ---------- detay paneli
function section(title, ...body) {
  return h('section', { class: 'd-sec' }, h('h3', { text: title }), ...body)
}
function listOf(items, cls, ordered) {
  const xs = arr(items)
  if (!xs.length) return h('p', { class: 'muted', text: '—' })
  return h(ordered ? 'ol' : 'ul', { class: cls }, xs.map(x => h('li', { text: str(x) })))
}
function resultView(res, a) {
  if (!res) return h('p', { class: 'muted', text: a.status === 'running' ? 'Agent çalışıyor; sonuç bitince gelir.' : 'Sonuç yok.' })
  if (res.kind === 'spec') return h('div', {},
    h('h4', { text: 'Kabul kriterleri' }), listOf(res.criteria, 'crit', true),
    h('h4', { text: 'Dosyalar' }), listOf(res.files, 'mono-list'),
    h('h4', { text: 'Kapsam dışı' }), listOf(res.outOfScope, 'plain'),
    h('h4', { text: 'Riskler' }), listOf(res.risks, 'plain risks'))
  if (res.kind === 'review') {
    const fs = arr(res.findings).filter(f => f && typeof f === 'object')
    if (!fs.length) return h('p', { class: 'clean', text: '✓ Bulgu yok' })
    const counts = Object.entries(fs.reduce((m, f) => ({ ...m, [str(f.severity)]: (m[str(f.severity)] ?? 0) + 1 }), {}))
    return h('div', {},
      h('p', { class: 'sev-sum' }, counts.map(([k, n]) => h('span', { class: `sev sev-${SEVERITY[k] ?? 'other'}`, text: `${n} ${k}` }))),
      fs.map(f => h('article', { class: `finding f-${SEVERITY[str(f.severity)] ?? 'other'}` },
        h('header', {}, h('span', { class: `sev sev-${SEVERITY[str(f.severity)] ?? 'other'}`, text: str(f.severity) || '?' }), h('code', { class: 'where', text: str(f.where) })),
        h('p', { text: str(f.issue) }),
        f.fix ? h('p', { class: 'fix' }, h('span', { class: 'fix-k', text: 'Öneri → ' }), str(f.fix)) : null)))
  }
  if (res.kind === 'qa') {
    const checks = arr(res.checks).filter(c => c && typeof c === 'object')
    return h('div', {},
      h('p', { class: `qa-banner ${res.pass ? 'ok' : 'bad'}`, text: res.pass ? '✓ QA geçti' : `✕ QA geçmedi · ${checks.filter(c => !c.ok).length} kontrol kaldı` }),
      h('ul', { class: 'checks' }, checks.map(c => h('li', { class: c.ok ? 'ok' : 'bad' },
        h('span', { class: 'ck-i', text: c.ok ? '✓' : '✕', 'aria-label': c.ok ? 'geçti' : 'kaldı' }),
        h('div', {}, h('p', { class: 'ck-t', text: str(c.criterion) }), h('p', { class: 'ck-e', text: str(c.evidence) }))))),
      h('h4', { text: 'Çalıştırılan komutlar' }), listOf(res.commands, 'mono-list'))
  }
  if (res.kind === 'text') return h('p', { class: 'res-text', text: str(res.text) })
  return h('p', { class: 'muted', text: 'Bilinmeyen sonuç türü.' })
}

function renderDetail() {
  const box = $('detail'), { sess, run } = current()
  const a = run?.agents.find(x => x.id === S.agentId)
  if (!a) {
    box.hidden = true
    $('scrim').hidden = true
    return
  }
  const keep = box.querySelector('.d-body')?.scrollTop ?? 0
  const R = ROLES[a.role]
  const dur = h('dd', { class: 'num' })
  S.live.push(() => { dur.textContent = fmtDur(agentEnd(a, run, sess) - a.startedAt) })
  const fact = (k, v) => h('div', {}, h('dt', { text: k }), typeof v === 'string' ? h('dd', { text: v }) : v)
  const steps = a.steps.length
    ? h('ol', { class: 'timeline' }, a.steps.map((x, i) => h('li', { class: i === a.steps.length - 1 && a.status === 'running' ? 'now' : '' },
      h('time', { class: 'num', title: fmtClock(x.t), text: x.t == null ? '?' : `+${fmtOff(x.t - a.startedAt)}` }),
      h('span', { class: 'tl-x', text: x.text }))))
    : h('p', { class: 'muted', text: 'Henüz adım yok.' })
  const body = h('div', { class: 'd-body' },
    h('dl', { class: 'facts' },
      fact('Rol', R.long), fact('Faz', a.phase ?? '—'), fact('Tur', String(a.round)),
      fact('Durum', h('dd', { class: `st s-${a.status}`, text: statusText(a.status) })),
      fact('Başladı', fmtClock(a.startedAt)), fact('Süre', dur)),
    section('Son adımlar', steps),
    section('Sonuç', resultView(a.result, a)))
  const close = h('button', { type: 'button', class: 'icon-btn d-close', 'data-k': 'dclose', 'aria-label': 'Detayı kapat', text: '✕', onclick: closeDetail })
  box.className = `detail r-${a.role} s-${a.status}`
  box.replaceChildren(
    h('div', { class: 'd-grab', 'aria-hidden': 'true' }),
    h('header', { class: 'd-head' }, glyph(a.role, 32), h('div', { class: 'd-ttl' }, h('h2', { id: 'd-title', text: a.label }), h('p', { class: 'd-sub', text: `${a.phase ?? '—'} · tur ${a.round}` })), close),
    body)
  box.hidden = false
  $('scrim').hidden = false
  body.scrollTop = keep
}
function openDetail(id) {
  S.agentId = id
  render()
  $('detail').querySelector('.d-close')?.focus({ preventScroll: true })
}
function closeDetail() {
  const id = S.agentId
  S.agentId = null
  render()
  for (const el of document.querySelectorAll('[data-k]')) if (el.dataset.k === `n${id}`) { el.focus({ preventScroll: true }); break }
}
$('scrim').addEventListener('click', closeDetail)
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.agentId) closeDetail() })

// ---------- lejant
$('legend').replaceChildren(
  ...['ba', 'dev', 'review', 'qa'].map(r => h('span', { class: `lg r-${r}` }, glyph(r, 16), ROLES[r].name)),
  h('span', { class: 'lg' }, s('svg', { width: 26, height: 10, 'aria-hidden': 'true' }, s('path', { d: 'M1,5 H25', class: 'lg-edge handoff' })), 'devir'),
  h('span', { class: 'lg' }, s('svg', { width: 26, height: 10, 'aria-hidden': 'true' }, s('path', { d: 'M1,5 H25', class: 'lg-edge loop' })), 'geri dönüş'))

// ---------- çizim döngüsü
function render() {
  const focusKey = document.activeElement?.dataset?.k
  S.live = []
  renderPickers()
  const { sess, run } = current()
  const key = run ? runKey(sess.id, run.taskId) : null
  const animate = key !== null && key === S.shown // run değişince eskileri canlandırma
  S.shown = key
  if (run && S.agentId && !run.agents.some(a => a.id === S.agentId)) S.agentId = null
  renderRunbar(sess, run)
  renderGraph(sess, run, animate)
  renderGantt(sess, run)
  renderFeed(run)
  renderDetail()
  if (focusKey) {
    for (const el of document.querySelectorAll('[data-k]')) if (el.dataset.k === focusKey) { el.focus({ preventScroll: true }); break }
  }
  tick()
}
function tick() {
  for (const f of S.live) f()
  const sess = S.sessions.get(S.sid)
  $('ago').textContent = sess ? `son güncelleme ${fmtAgo(serverNow() - sess.receivedAt)}` : 'veri bekleniyor'
}
setInterval(tick, 1000)

// ---------- SSE: EventSource kendi deniyorsa bekle; CLOSED olursa önce /api/me, sonra backoff ile yeniden aç
let es = null, retry = 1000, retryTimer = 0
function setConn(state, text) {
  $('conn').dataset.state = state
  $('conn-t').textContent = text
}
const parse = ev => { try { return JSON.parse(ev.data) } catch { return null } }
function connect() {
  clearTimeout(retryTimer)
  es = new EventSource('/events')
  es.onopen = () => { retry = 1000; setConn('on', 'canlı') }
  es.addEventListener('snapshot', ev => {
    const d = parse(ev)
    if (!d) return
    const ids = new Set()
    for (const x of arr(d.sessions)) { ingest(x, d.serverNow); ids.add(str(x.id)) }
    for (const id of [...S.sessions.keys()]) if (!ids.has(id)) S.sessions.delete(id)
    pickDefault()
    render()
  })
  es.addEventListener('session', ev => {
    const d = parse(ev)
    if (!d?.session) return
    ingest(d.session, d.serverNow)
    pickDefault()
    render()
  })
  es.addEventListener('remove', ev => {
    const d = parse(ev)
    if (!d) return
    if (num(d.serverNow) != null) S.off = d.serverNow - Date.now()
    S.sessions.delete(str(d.id))
    pickDefault()
    render()
  })
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return setConn('wait', 'yeniden bağlanıyor')
    setConn('off', 'bağlantı koptu')
    es.close()
    recover()
  }
}
async function recover() {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 401) { location.href = '/login'; return }
  } catch {}
  retryTimer = setTimeout(connect, retry)
  retry = Math.min(retry * 2, 30000)
}

render()
connect()
