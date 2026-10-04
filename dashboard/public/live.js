// Canlı görünüm: Şef (orkestratör), takımyıldız (Şef ve doğurduğu agent'lar/run'lar), seçili workflow
// run'ının akış grafiği (zaman yolculuğu ve kritik yol ile), oturum geneli zaman çubukları, olaylar, detay.
import {
  $, h, s, put, motion, glyph, className, fmtDur, fmtClock, fmtShort, fmtOff, fmtAgo, fmtCost, fmtTok, fmtPct, model,
  totalTok, statusText, STATUS, RUN_STATUS, MAIN_STATE, CLASS, CLASS_ORDER, arr, str,
} from './util.js'
import {
  S, serverNow, modNow, current, findAgent, runOf, lastStepT, runEnd, sessionStart, isLive, seenOf, anomalies, warn,
} from './state.js'

let api = { render() {}, openSession() {} }
export const initLive = a => (api = a)
export const live = [] // saniyede bir çalışan güncelleyiciler

// ---------- zaman
const mainEnd = (a, v) => (a.status !== 'idle' ? modNow(v) : Math.max(a.since ?? 0, lastStepT(a)))
const endOf = (a, v) => (a.main ? mainEnd(a, v) : a.endedAt ?? (a.status === 'running' ? modNow(v) : runOf(v, a)?.endedAt ?? lastStepT(a)))
const sessEnd = v => (isLive(v) ? modNow(v) : Math.max(v.sentAt, ...v.runs.map(r => r.endedAt ?? 0), ...v.subs.map(x => x.endedAt ?? 0)))

// ---------- zaman yolculuğu: run'ın t anındaki hali
function runAt(run, t) {
  const agents = run.agents.filter(a => a.startedAt <= t).map(a => {
    const ended = a.endedAt != null && a.endedAt <= t
    return { ...a, status: ended ? a.status : 'running', endedAt: ended ? a.endedAt : null, steps: a.steps.filter(x => x.t == null || x.t <= t), result: ended ? a.result : null }
  })
  const ids = new Set(agents.map(a => a.id))
  const ended = run.endedAt != null && run.endedAt <= t
  return { ...run, agents, edges: run.edges.filter(e => ids.has(e.from) && ids.has(e.to)), status: ended ? run.status : 'running', endedAt: ended ? run.endedAt : null, replayT: t }
}

// kritik yol: her dalganın en uzun agent'ı; paralellik: agent süreleri toplamı / duvar saati
function runMetrics(run, v) {
  const waves = new Map()
  for (const a of run.agents) {
    const d = endOf(a, v) - a.startedAt
    const w = waves.get(a.wave)
    if (!w || d > w.d) waves.set(a.wave, { a, d })
  }
  const crit = new Set([...waves.values()].map(x => x.a.id))
  const busy = run.agents.reduce((sum, a) => sum + Math.max(0, endOf(a, v) - a.startedAt), 0)
  const wall = Math.max(1, (run.replayT ?? runEnd(run, v)) - run.startedAt)
  const cost = run.agents.reduce((sum, a) => sum + a.tokens.cost, 0)
  return { crit, par: busy / wall, cost }
}

// ---------- oturum çubuğu
function burn(v) {
  const xs = S.samples.get(v.id) ?? []
  const now = xs.at(-1)?.t ?? 0
  const old = xs.find(x => now - x.t <= 10 * 60e3) ?? xs[0]
  const rate = old && now > old.t ? ((xs.at(-1).cost - old.cost) / (now - old.t)) * 3600e3 : 0
  return { rate, xs: xs.slice(-40) }
}
function sparkline(xs) {
  if (xs.length < 2) return s('svg', { class: 'spark', viewBox: '0 0 80 22', width: 80, height: 22, 'aria-hidden': 'true' })
  const t0 = xs[0].t, t1 = xs.at(-1).t || t0 + 1, c0 = xs[0].cost, c1 = Math.max(c0 + 1e-9, xs.at(-1).cost)
  const pts = xs.map(x => `${(((x.t - t0) / (t1 - t0 || 1)) * 78 + 1).toFixed(1)},${(21 - ((x.cost - c0) / (c1 - c0)) * 19).toFixed(1)}`)
  return s('svg', { class: 'spark', viewBox: '0 0 80 22', width: 80, height: 22, 'aria-hidden': 'true' },
    s('polyline', { points: pts.join(' '), class: 'spark-l' }))
}
const stat = (k, v, tip) => h('span', { class: 'stat', tip }, h('span', { class: 'k', text: k }), typeof v === 'string' ? h('b', { class: 'num', text: v }) : v)

function renderSessbar(v) {
  const bar = $('sessbar')
  if (!v) return bar.replaceChildren(h('div', { class: 'rb-title' }, h('span', { class: 'rb-name', text: 'wf·akış' }), h('span', { class: 'rb-repo', text: 'veri bekleniyor' })))
  const t = v.totals
  const dur = h('b', { class: 'num' })
  const rate = h('b', { class: 'num' })
  const spark = h('span', { class: 'spark-w' })
  live.push(() => {
    dur.textContent = fmtDur(sessEnd(v) - sessionStart(v))
    const b = burn(v)
    rate.textContent = isLive(v) && b.rate > 0 ? `${fmtCost(b.rate)}/sa` : '—'
    spark.replaceChildren(sparkline(b.xs))
  })
  const hit = t.in + t.cr + t.cw ? t.cr / (t.in + t.cr + t.cw) : 0
  const graphRatio = t.graph.g + t.graph.r ? t.graph.g / (t.graph.g + t.graph.r) : 0
  const liveNow = isLive(v)
  bar.replaceChildren(
    h('div', { class: 'rb-title' },
      h('span', { class: 'rb-name', text: v.repo || 'session' }),
      h('span', { class: 'rb-repo', text: v.main?.goal || v.id })),
    h('span', { class: `chip run-st ${liveNow ? 's-running' : 's-done'}`, text: liveNow ? '● canlı' : '✓ sakin' }),
    h('div', { class: 'stats' },
      stat('süre', dur),
      stat('maliyet', h('b', { class: 'num cost', text: fmtCost(t.cost) }), 'API liste fiyatıyla karşılığı (abonelik faturası farklıdır)'),
      stat('token', fmtTok(t.in + t.out + t.cr + t.cw), `giriş ${fmtTok(t.in)} · çıkış ${fmtTok(t.out)} · cache okuma ${fmtTok(t.cr)} · cache yazma ${fmtTok(t.cw)}`),
      stat('cache', fmtPct(hit), 'cache okumanın toplam girişe oranı: yüksek = ucuz'),
      stat('graf-önce', fmtPct(graphRatio), 'graphify çağrılarının (graphify + dosya tarama) içindeki payı: yüksek = codebase baştan okunmuyor'),
      stat('agent', String(t.agents)),
      stat('yanma', h('span', { class: 'burn' }, rate, spark), 'son 10 dakikanın maliyet hızı')))
}

// ---------- Şef kartı
function toolBars(tools) {
  const xs = Object.entries(tools).sort((a, b) => b[1] - a[1])
  if (!xs.length) return h('p', { class: 'muted small', text: 'Henüz araç çağrısı yok.' })
  const top = xs.slice(0, 6)
  const rest = xs.slice(6).reduce((n, [, c]) => n + c, 0)
  if (rest) top.push(['diğer', rest])
  const max = top[0][1]
  return h('ul', { class: 'tools' }, top.map(([k, n]) => h('li', { tip: `${k}: ${n} çağrı` },
    h('span', { class: 'tl-k', text: k }),
    h('span', { class: 'tl-bar' }, h('span', { class: `tl-fill${/graphify/i.test(k) ? ' g' : ''}`, style: `width:${Math.max(4, (n / max) * 100)}%` })),
    h('span', { class: 'tl-n num', text: String(n) }))))
}
function graphMeter(g) {
  const tot = g.g + g.r
  const p = tot ? g.g / tot : 0
  return h('div', { class: 'gmeter', tip: `graphify ${g.g} · dosya tarama ${g.r}` },
    h('span', { class: 'gm-k', text: 'graf-önce' }),
    h('span', { class: 'gm-bar' }, h('span', { class: 'gm-fill', style: `width:${p * 100}%` })),
    h('span', { class: 'gm-v num', text: tot ? fmtPct(p) : '—' }))
}

function renderOrch(v) {
  const box = $('orch')
  if (!v?.main) {
    box.replaceChildren(h('div', { class: 'empty small' }, h('p', { class: 'empty-t', text: 'Şef sessiz' }), h('p', { text: 'Orkestratör verisi wf-monitor v3 ile gelir.' })))
    $('constellation').replaceChildren()
    return
  }
  const m = v.main
  const since = h('span', { class: 'num' })
  live.push(() => { since.textContent = m.since ? fmtDur(modNow(v) - m.since) : '' })
  const state = m.status === 'tool' ? `⚙ ${m.tool || 'araç'}` : m.status === 'thinking' ? '◌ düşünüyor' : '○ boşta'
  put(box,
    h('button', { type: 'button', class: `chef s-${m.status}${S.agentId === 'main' ? ' sel' : ''}`, 'data-k': 'nmain', onclick: () => openDetail('main') },
      h('span', { class: 'chef-head' },
        h('span', { class: 'chef-orb' }, glyph('orchestrator', 34)),
        h('span', { class: 'chef-t' }, h('b', { text: 'Şef' }), h('span', { class: 'chef-sub', text: `${model(m.model)} · tur ${m.turns}` })),
        h('span', { class: `chef-st st-${m.status}` }, h('span', { text: state }), ' ', since)),
      m.goal ? h('span', { class: 'chef-goal', text: m.goal }) : null,
      m.answer ? h('span', { class: 'chef-ans', text: m.answer }) : null,
      h('span', { class: 'chef-nums' },
        stat('token', fmtTok(totalTok(m.tokens))),
        stat('maliyet', fmtCost(m.tokens.cost)),
        stat('araç', String(Object.values(m.tools).reduce((a, b) => a + b, 0))),
        stat('alt agent', String(v.subs.length + v.runs.reduce((n, r) => n + r.agents.length, 0))))),
    graphMeter(m.graph),
    h('div', { class: 'chef-tools' }, toolBars(m.tools)),
    m.steps.length ? h('ol', { class: 'chef-steps' }, m.steps.slice(-6).reverse().map(x =>
      h('li', {}, h('time', { class: 'num', text: fmtShort(x.t) }), h('span', { class: 'cs-x', text: x.text })))) : null)
  renderConstellation(v)
}

// ---------- takımyıldız: Şef merkezde, alt agent'lar ve run'lar doğuş sırasıyla halkalarda
const MAX_SAT = 22
function renderConstellation(v) {
  const box = $('constellation')
  const items = [
    ...v.subs.map(x => ({ kind: 'sub', id: x.id, t: x.startedAt, a: x, parent: x.parent })),
    ...v.runs.map(r => ({ kind: 'run', id: r.taskId, t: r.startedAt, r, parent: r.parent })),
  ].sort((a, b) => a.t - b.t)
  // dar ekranda kare, yakın halkalar: etiketler telefonda okunur boyutta kalsın
  const N = narrow.matches
  const max = N ? 16 : MAX_SAT
  const hidden = Math.max(0, items.length - max)
  const shown = items.slice(-max)
  const W = N ? 360 : 640, H = N ? 400 : 340, cx = W / 2, cy = H / 2 + 6
  const pos = new Map([['main', [cx, cy]]])
  const rings = N ? [{ n: 7, rx: 112, ry: 112 }, { n: 9, rx: 158, ry: 172 }] : [{ n: 10, rx: 190, ry: 98 }, { n: 12, rx: 290, ry: 148 }]
  let i = 0
  for (const ring of rings) {
    const list = shown.slice(i, i + ring.n)
    list.forEach((it, k) => {
      const ang = -Math.PI / 2 + ((k + 0.5) / list.length) * Math.PI * 2 + (ring === rings[1] ? 0.13 : 0)
      pos.set(it.id, [cx + Math.cos(ang) * ring.rx, cy + Math.sin(ang) * ring.ry])
    })
    i += ring.n
  }
  const seen = seenOf(v.id)
  const svg = s('svg', { class: 'const', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Şef ve doğurduğu agent\'lar' })
  const edges = s('g', { class: 'c-edges' })
  const nodes = s('g', { class: 'c-nodes' })
  const anim = []
  for (const it of shown) {
    const [x, y] = pos.get(it.id)
    const [px, py] = pos.get(it.parent) ?? pos.get('main')
    const mx = (x + px) / 2 + (py - y) * 0.12, my = (y + py) / 2 + (x - px) * 0.12
    const cls = it.kind === 'sub' ? it.a.cls : 'run'
    const p = s('path', { d: `M${px},${py} Q${mx},${my} ${x},${y}`, class: `c-edge c-${cls}` })
    edges.append(p)
    const k = `c${it.id}`
    if (!seen.has(k) && motion() && seen.has('c-init')) anim.push(p)
    seen.add(k)
    nodes.append(it.kind === 'sub' ? subSat(v, it.a, x, y) : runSat(v, it.r, x, y))
  }
  seen.add('c-init')
  const m = v.main
  const chef = s('g', { class: `c-chef s-${m.status}`, transform: `translate(${cx},${cy})`, role: 'button', tabindex: '0', 'aria-label': `Şef, ${MAIN_STATE[m.status]}`, 'data-k': 'cmain' },
    s('circle', { r: 30, class: 'c-halo' }),
    s('circle', { r: 22, class: 'c-core' }),
    nest(glyph('orchestrator', 30), -15, -15),
    s('text', { y: 44, 'text-anchor': 'middle', class: 'c-lab strong', text: 'Şef' }))
  click(chef, () => openDetail('main'))
  svg.append(edges, nodes, chef)
  if (hidden) svg.append(s('text', { x: 12, y: H - 10, class: 'c-more', text: `+${hidden} eski agent gizli` }))
  box.replaceChildren(svg)
  for (const p of anim) {
    const len = p.getTotalLength()
    p.style.strokeDasharray = `${len}`
    p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)' }).finished.then(() => (p.style.strokeDasharray = ''), () => {})
  }
}
const nest = (svgEl, x, y) => (svgEl.setAttribute('x', x), svgEl.setAttribute('y', y), svgEl)
function click(el, f) {
  el.addEventListener('click', f)
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f() } })
}
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
function subSat(v, a, x, y) {
  const bad = anomalies(a, v).length
  const g = s('g', { class: `c-sat c-${a.cls} s-${a.status}${S.agentId === a.id ? ' sel' : ''}`, transform: `translate(${x},${y})`, role: 'button', tabindex: '0', 'data-k': `c${a.id}`,
    'aria-label': `${a.label}, ${className(a.cls)}, ${STATUS[a.status].t}`, tip: `${a.label} · ${className(a.cls)} · ${fmtCost(a.tokens.cost)} · ${fmtTok(totalTok(a.tokens))} token` },
  a.status === 'running' ? s('circle', { r: 19, class: 'c-pulse' }) : null,
  s('circle', { r: 16, class: 'c-bg' }),
  nest(glyph(a.cls, 22), -11, -11),
  bad ? s('text', { x: 14, y: -12, class: 'c-warn', text: '⚠' }) : null,
  a.status === 'failed' ? s('text', { x: 14, y: -12, class: 'c-fail', text: '✕' }) : null,
  s('text', { y: 30, 'text-anchor': 'middle', class: 'c-lab', text: clip(a.label, 18) }),
  s('text', { y: 42, 'text-anchor': 'middle', class: 'c-cost', text: fmtCost(a.tokens.cost) }))
  click(g, () => openDetail(a.id))
  return g
}
function runSat(v, r, x, y) {
  const cost = r.agents.reduce((n, a) => n + a.tokens.cost, 0)
  const g = s('g', { class: `c-run s-${r.status}${S.tid === r.taskId ? ' sel' : ''}`, transform: `translate(${x},${y})`, role: 'button', tabindex: '0', 'data-k': `c${r.taskId}`,
    'aria-label': `workflow ${r.name}, ${RUN_STATUS[r.status]}, ${r.agents.length} agent`, tip: `workflow ${r.name} · ${r.agents.length} agent · ${fmtCost(cost)}` },
  s('rect', { x: -46, y: -15, width: 92, height: 30, rx: 9, class: 'c-runbox' }),
  s('text', { x: -36, y: 5, class: 'c-run-i', text: r.status === 'running' ? '◆' : STATUS[r.status].i }),
  s('text', { x: -24, y: 4, class: 'c-run-t', text: clip(r.name, 10) }),
  s('text', { y: 30, 'text-anchor': 'middle', class: 'c-cost', text: `${r.agents.length} agent · ${fmtCost(cost)}` }))
  click(g, () => { Object.assign(S, { tid: r.taskId, pinned: true, replay: null }); api.render(); $('graph-panel').scrollIntoView({ block: 'nearest', behavior: motion() ? 'smooth' : 'auto' }) })
  return g
}

// ---------- run akış grafiği: phase sütunları × tur satırları
function renderRunPanel(v, realRun) {
  const head = $('runhead')
  const box = $('graph')
  S.redraw = null
  if (!realRun) {
    head.replaceChildren(h('h2', { id: 'h-graph', text: 'Workflow' }), h('span', { class: 'phint', text: 'bu session\'da workflow yok' }))
    box.replaceChildren(h('div', { class: 'empty' }, h('p', { class: 'empty-t', text: 'Workflow yok' }), h('p', { text: 'Şef bir workflow başlatınca phase ve turlarıyla burada akar.' })))
    return
  }
  const replaying = S.replay?.tid === realRun.taskId && realRun.status !== 'running'
  const run = replaying ? runAt(realRun, S.replay.t) : realRun
  const met = runMetrics(run, v)
  const norm = S.norms.wf[realRun.name]
  const forecast = norm && norm.runs >= 2 ? h('span', { class: 'chip ghost-chip', tip: `son 30 günde ${norm.runs} ${realRun.name} run'ının ortalaması` }, `ort. ${fmtCost(norm.avg)}`) : null
  put(head,
    h('h2', { id: 'h-graph', text: 'Workflow' }),
    h('span', { class: 'rh-name', text: realRun.name }),
    h('span', { class: `chip run-st s-${run.status}`, text: `${STATUS[run.status].i} ${RUN_STATUS[run.status]}` }),
    h('span', { class: 'chip ghost-chip', tip: 'agent sürelerinin toplamı / duvar saati: paralel çalışmanın etkisi' }, `paralellik ${met.par.toFixed(1)}×`),
    h('span', { class: 'chip ghost-chip cost', tip: 'bu run\'daki agent\'ların toplam maliyeti' }, fmtCost(met.cost)),
    forecast,
    h('span', { class: 'rh-sp' }),
    h('button', { type: 'button', class: `fbtn${S.crit ? ' on' : ''}`, 'aria-pressed': String(S.crit), onclick: () => { S.crit = !S.crit; api.render() }, tip: 'her dalganın en uzun süren agent\'ı: run süresini bunlar belirler' }, 'kritik yol'),
    realRun.status !== 'running' ? replayCtl(realRun, v) : null)

  const phases = run.phases.length ? [...run.phases] : [...new Set(run.agents.map(a => a.phase).filter(Boolean))]
  const cols = run.agents.some(a => !phases.includes(a.phase)) ? [...phases, 'Diğer'] : phases
  if (!cols.length) cols.push('Agent')
  const colOf = a => { const i = phases.indexOf(a.phase); return i >= 0 ? i : cols.length - 1 }
  const rounds = Math.max(1, ...run.agents.map(a => a.round))
  const V = narrow.matches
  const grid = h('div', { class: V ? 'grid v' : 'grid' })
  const nCols = V ? rounds : cols.length, nRows = V ? cols.length : rounds
  grid.style.gridTemplateColumns = V ? `var(--phw) repeat(${nCols}, var(--colw))` : `var(--rhw) repeat(${nCols}, minmax(var(--colw), 1fr))`
  const place = (el, row, col) => { el.style.gridRow = row; el.style.gridColumn = col; grid.append(el); return el }
  const at = (el, phaseIdx, round) => (V ? place(el, phaseIdx + 2, round + 1) : place(el, round + 1, phaseIdx + 2))
  for (let i = 0; i < nCols; i++) place(h('div', { class: 'lane' }), `1 / span ${nRows + 1}`, i + 2)
  const pad2 = n => String(n).padStart(2, '0')
  const phaseHeads = cols.map((p, i) => h('div', { class: 'ph' }, h('span', { class: 'ph-i', text: pad2(i + 1) }), h('span', { class: 'ph-t', text: p })))
  const roundHeads = Array.from({ length: rounds }, (_, i) => h('div', { class: 'rh' }, h('span', { text: 'tur' }), h('b', { text: String(i + 1) })))
  phaseHeads.forEach((el, i) => (V ? place(el, i + 2, 1) : place(el, 1, i + 2)))
  roundHeads.forEach((el, i) => (V ? place(el, 1, i + 2) : place(el, i + 2, 1)))
  const colHeads = V ? roundHeads : phaseHeads, rowHeads = V ? phaseHeads : roundHeads
  const colIdx = a => (V ? a.round - 1 : colOf(a))
  const seen = seenOf(v.id)
  const animate = !replaying && seen.has(`r${run.taskId}`)
  seen.add(`r${run.taskId}`)
  const cells = new Map()
  const nodes = new Map()
  for (const a of run.agents) {
    const ck = `${colOf(a)}|${a.round}`
    if (!cells.has(ck)) cells.set(ck, at(h('div', { class: 'cell' }), colOf(a), a.round))
    const el = nodeEl(v, a, S.crit && met.crit.has(a.id))
    nodes.set(a.id, el)
    cells.get(ck).append(el)
    const k = `n${a.id}`
    if (animate && !seen.has(k) && motion()) el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' })
    if (!replaying) seen.add(k)
  }
  const svg = s('svg', { class: 'edges', 'aria-hidden': 'true' })
  const canvas = h('div', { class: 'canvas' }, svg, grid)
  box.replaceChildren(canvas)
  if (V && rounds > (S.rounds ?? 0)) box.scrollLeft = box.scrollWidth
  S.rounds = rounds
  let first = animate
  S.redraw = () => { drawEdges({ canvas, svg, grid, run, seen, nodes, colHeads, rowHeads, colIdx, colOf, V, crit: S.crit ? met.crit : null, replaying }, first); first = false }
  ro.disconnect()
  ro.observe(canvas)
}
const ro = new ResizeObserver(() => S.redraw?.())
export const narrow = matchMedia('(max-width: 760px)')

// Zaman yolculuğu: bitmiş run'ı baştan oynat ya da kaydırıcıyla bir ana git
let player = 0
function replayCtl(run, v) {
  const t0 = run.startedAt, t1 = runEnd(run, v)
  const cur = S.replay?.tid === run.taskId ? S.replay.t : t1
  const range = h('input', { type: 'range', min: 0, max: 1000, value: Math.round(((cur - t0) / Math.max(1, t1 - t0)) * 1000), class: 'scrub', 'aria-label': 'Run zamanında git' })
  const label = h('span', { class: 'num scrub-t', text: `+${fmtOff(cur - t0)}` })
  const set = t => {
    S.replay = t >= t1 ? null : { tid: run.taskId, t }
    api.render()
  }
  range.addEventListener('input', () => set(t0 + (Number(range.value) / 1000) * (t1 - t0)))
  const play = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': player ? 'Durdur' : 'Baştan oynat', text: player ? '❚❚' : '▶', onclick: () => {
    if (player) { clearInterval(player); player = 0; return api.render() }
    let t = t0
    const stepMs = (t1 - t0) / 120
    S.replay = { tid: run.taskId, t }
    player = setInterval(() => {
      t += stepMs
      if (t >= t1 || S.tid !== run.taskId) { clearInterval(player); player = 0; S.replay = null } else S.replay = { tid: run.taskId, t }
      api.render()
    }, motion() ? 100 : 400)
    api.render()
  } })
  return h('span', { class: 'replay', tip: 'zaman yolculuğu: run\'ı adım adım yeniden izle' }, play, range, label)
}

function nodeEl(v, a, crit) {
  const dur = h('span', { class: 'n-dur num' })
  live.push(() => { dur.textContent = fmtDur(endOf(a, v) - a.startedAt) })
  const warns = anomalies(a, v)
  const last = a.status === 'running' && a.steps.length ? h('span', { class: 'n-step', text: a.steps.at(-1).text }) : null
  return h('button', {
    type: 'button',
    class: `node c-${a.cls} s-${a.status}${S.agentId === a.id ? ' sel' : ''}${crit ? ' crit' : ''}`,
    'data-k': `n${a.id}`,
    'aria-label': `${a.label}, ${className(a.cls)}, tur ${a.round}, ${STATUS[a.status].t}${warns.length ? ', uyarı: ' + warns.map(w => w.text).join(', ') : ''}`,
    'aria-expanded': S.agentId === a.id ? 'true' : 'false',
    onclick: () => openDetail(a.id),
  },
  glyph(a.cls),
  h('span', { class: 'n-main' },
    h('span', { class: 'n-label', text: a.label }),
    h('span', { class: 'n-sub' }, h('span', { class: 'n-st', text: statusText(a.status) }), h('span', { class: 'n-sep', text: '·' }), dur,
      a.tokens.cost ? h('span', { class: 'n-cost num', text: fmtCost(a.tokens.cost) }) : null),
    last),
  warns.length ? h('span', { class: 'n-warn', tip: warns.map(w => w.text).join(' · '), text: '⚠' }) : null,
  a.graph.g ? h('span', { class: 'n-graph', tip: `graphify ${a.graph.g} kez`, text: '◈' }) : null)
}

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

function drawEdges({ canvas, svg, grid, run, seen, nodes, colHeads, rowHeads, colIdx, colOf, V, crit, replaying }, animate) {
  const base = canvas.getBoundingClientRect()
  const box = el => {
    const r = el.getBoundingClientRect()
    return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cy: (r.top + r.bottom) / 2 - base.top }
  }
  const cs = getComputedStyle(grid)
  const cg = parseFloat(cs.columnGap) || 40, rg = parseFloat(cs.rowGap) || 36
  const cr = colHeads.map(box), rr = rowHeads.map(box)
  const gapL = c => cr[c].l - cg / 2
  const laneAbove = row => rr[row - 1].t - rg / 2
  svg.setAttribute('width', canvas.scrollWidth)
  svg.setAttribute('height', canvas.scrollHeight)
  const defs = s('defs', {}, ...[...CLASS_ORDER, 'loop'].map(k =>
    s('marker', { id: `mk-${k}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' },
      s('path', { d: 'M0,0 L10,5 L0,10 z', class: `mk c-${k}` }))))
  const paths = [], flows = [], tags = new Map()
  const byId = new Map(run.agents.map(a => [a.id, a]))
  for (const e of run.edges) {
    const A = byId.get(e.from), B = byId.get(e.to)
    const na = nodes.get(e.from), nb = nodes.get(e.to)
    if (!A || !B || !na || !nb) continue
    const a = box(na), b = box(nb), ca = colIdx(A), cb = colIdx(B)
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
      const sx = gapL(ca) + 7, tx = gapL(cb) + 7, ly = laneAbove(B.round) - 8
      pts = [[a.l, a.cy], [sx, a.cy], [sx, ly], [tx, ly], [tx, b.cy], [b.l, b.cy]]
      tags.set(B.id, [tx + 10, ly - 6, B.round])
    }
    const d = roundPath(pts)
    const kind = loop ? 'loop' : 'handoff'
    const onCrit = crit && crit.has(A.id) && crit.has(B.id)
    const path = s('path', { d, class: `edge ${kind} c-${A.cls}${onCrit ? ' crit' : ''}${crit && !onCrit ? ' dim' : ''}`, 'marker-end': `url(#mk-${loop ? 'loop' : B.cls})` })
    paths.push(path)
    const k = `e${e.from}>${e.to}`
    if (animate && !seen.has(k) && motion()) flows.push([path, s('path', { d, class: `flow ${kind}` })])
    if (!replaying) seen.add(k)
  }
  const labels = [...tags.values()].map(([x, y, round]) => s('text', { x, y, class: 'loop-tag', text: `↺ tur ${round}` }))
  svg.replaceChildren(defs, ...paths, ...labels, ...flows.map(f => f[1]))
  for (const [path, flow] of flows) {
    const len = flow.getTotalLength()
    flow.style.strokeDasharray = `18 ${len + 18}`
    path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' })
    flow.animate([{ strokeDashoffset: 18 }, { strokeDashoffset: -len }], { duration: 1200, easing: 'cubic-bezier(.4,0,.2,1)' }).finished
      .then(() => flow.remove(), () => flow.remove())
  }
}

// ---------- oturum geneli zaman çubukları: Şef, alt agent'lar, run grupları
const MAX_ROWS = 70
function renderGantt(v) {
  const box = $('gantt')
  if (!v) return box.replaceChildren(h('p', { class: 'muted pad', text: 'Agent yok.' }))
  const rows = []
  if (v.main) rows.push({ a: v.main })
  const groups = [
    ...v.subs.map(x => ({ t: x.startedAt, rows: [{ a: x }] })),
    ...v.runs.map(r => ({ t: r.startedAt, rows: [{ head: r }, ...r.agents.map(a => ({ a, inRun: true }))] })),
  ].sort((a, b) => a.t - b.t)
  for (const g of groups) rows.push(...g.rows)
  const cut = Math.max(0, rows.length - MAX_ROWS)
  const shown = cut ? [rows[0], ...rows.slice(cut + 1)] : rows
  const axis = h('div', { class: 'g-ticks' })
  const nowLine = h('span', { class: 'g-now' })
  const items = shown.map(row => {
    if (row.head) {
      const r = row.head
      const bar = h('span', { class: `g-bar g-runbar s-${r.status}` })
      return { r, bar, el: h('button', { type: 'button', class: `g-row g-head${S.tid === r.taskId ? ' sel' : ''}`, onclick: () => { Object.assign(S, { tid: r.taskId, pinned: true, replay: null }); api.render() } },
        h('span', { class: 'g-lab' }, h('span', { class: 'g-wf', text: '◆' }), h('span', { class: 'g-name', text: `workflow ${r.name}` })),
        h('span', { class: 'g-track' }, bar)) }
    }
    const a = row.a
    const bar = h('span', { class: `g-bar c-${a.cls} s-${a.main ? 'running' : a.status}${a.main ? ' g-main' : ''}` })
    const ticks = a.main ? h('span', { class: 'g-ticks-main' }) : null
    return { a, bar, ticks, el: h('button', {
      type: 'button', class: `g-row${row.inRun ? ' in-run' : ''}${S.agentId === a.id ? ' sel' : ''}`, 'data-k': `g${a.id}`,
      'aria-label': `${a.label}: ${a.main ? MAIN_STATE[a.status] : STATUS[a.status].t}`, onclick: () => openDetail(a.id),
    },
    h('span', { class: 'g-lab' }, glyph(a.cls, 18), h('span', { class: 'g-name', text: a.label })),
    h('span', { class: 'g-track' }, bar, ticks)) }
  })
  box.replaceChildren(
    h('div', { class: 'g-axis' }, h('span', { class: 'g-lab muted', text: cut ? `+${cut} gizli` : 'agent' }), h('span', { class: 'g-track' }, axis)),
    h('div', { class: 'g-rows' }, items.map(x => x.el), h('span', { class: 'g-overlay' }, nowLine)))
  live.push(() => {
    const t0 = sessionStart(v), t1 = sessEnd(v), span = Math.max(t1 - t0, 1000)
    const pct = t => `${(Math.min(Math.max(t - t0, 0), span) / span) * 100}%`
    for (const it of items) {
      if (it.r) {
        it.bar.style.left = pct(it.r.startedAt)
        it.bar.style.width = `max(4px, ${((runEnd(it.r, v) - it.r.startedAt) / span) * 100}%)`
        continue
      }
      const st = it.a.startedAt, en = endOf(it.a, v)
      it.bar.style.left = pct(st)
      it.bar.style.width = `max(4px, ${((Math.max(en - st, 0)) / span) * 100}%)`
      if (it.ticks && !it.ticks.childElementCount)
        it.ticks.replaceChildren(...it.a.steps.filter(x => x.t != null).map(x => { const tk = h('i', { tip: `${fmtClock(x.t)} · ${x.text}` }); tk.style.left = pct(x.t); return tk }))
      else if (it.ticks) for (const [i, x] of it.a.steps.filter(x => x.t != null).entries()) it.ticks.children[i] && (it.ticks.children[i].style.left = pct(x.t))
    }
    nowLine.hidden = !isLive(v)
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map(x => x * 1000)
    const step = steps.find(x => span / x <= 6) ?? 3600e3 * 8
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
const FILTERS = [['handoff', 'Doğum/devir'], ['end', 'Bitiş'], ['error', 'Hata'], ['warn', 'Uyarı'], ['art', 'Eser']]
const filterBtns = FILTERS.map(([k, label]) => {
  const count = h('span', { class: 'f-n num' })
  const b = h('button', { type: 'button', class: `fbtn f-${k}`, 'aria-pressed': 'true', onclick: () => {
    S.filters[k] = !S.filters[k]
    b.setAttribute('aria-pressed', String(S.filters[k]))
    renderFeed(current().v)
  } }, h('span', { class: 'f-dot', 'aria-hidden': 'true' }), label, count)
  b.count = count
  return [k, b]
})
$('filters').replaceChildren(...filterBtns.map(x => x[1]))

function renderFeed(v) {
  const list = $('feed')
  const evs = v ? [...(S.logs.get(v.id)?.values() ?? [])] : []
  for (const [k, b] of filterBtns) b.count.textContent = String(evs.filter(e => e.type === k).length)
  const shown = evs.filter(e => S.filters[e.type]).sort((a, b) => b.t - a.t).slice(0, 200)
  if (!shown.length) return list.replaceChildren(h('li', { class: 'muted pad', text: v ? 'Bu filtrede olay yok.' : 'Session seçilmedi.' }))
  list.replaceChildren(...shown.map(e => {
    const inner = [h('time', { class: 'num', text: fmtClock(e.t) }), h('span', { class: `ev-i${e.cls ? ' c-' + e.cls : ''}`, 'aria-hidden': 'true', text: e.icon }), h('span', { class: 'ev-x', text: e.text })]
    const cls = `ev t-${e.type}${e.loop ? ' loop' : ''}`
    const go = e.agent ? () => openDetail(e.agent) : e.run ? () => { Object.assign(S, { tid: e.run, pinned: true, replay: null }); api.render() } : null
    return h('li', { class: cls }, go ? h('button', { type: 'button', class: 'ev-b', onclick: go }, inner) : h('div', { class: 'ev-b' }, inner))
  }))
}

// anomalileri günlüğe (ve bildirime) bir kez yaz
function scanAnomalies(v) {
  if (!v) return
  for (const a of [...v.subs, ...v.runs.flatMap(r => r.agents)])
    for (const w of anomalies(a, v)) warn(v.id, `w${a.id}${w.k}`, { t: modNow(v), agent: a.id, cls: a.cls, text: `${a.label}: ${w.text}` })
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
const SEVERITY = { Critical: 'critical', Important: 'important', Minor: 'minor' }
const sevKey = k => (Object.hasOwn(SEVERITY, k) ? SEVERITY[k] : 'other')
function resultView(res, a) {
  if (!res) return h('p', { class: 'muted', text: a.status === 'running' ? 'Agent çalışıyor; sonuç bitince gelir.' : 'Sonuç yok.' })
  if (res.kind === 'spec') return h('div', {},
    h('h4', { text: 'Kabul kriterleri' }), listOf(res.criteria, 'crit-list', true),
    h('h4', { text: 'Dosyalar' }), listOf(res.files, 'mono-list'),
    h('h4', { text: 'Kapsam dışı' }), listOf(res.outOfScope, 'plain'),
    h('h4', { text: 'Riskler' }), listOf(res.risks, 'plain risks'))
  if (res.kind === 'review') {
    const fs = arr(res.findings).filter(f => f && typeof f === 'object')
    if (!fs.length) return h('p', { class: 'clean', text: '✓ Bulgu yok' })
    const counts = new Map()
    for (const f of fs) counts.set(str(f.severity), (counts.get(str(f.severity)) ?? 0) + 1)
    return h('div', {},
      h('p', { class: 'sev-sum' }, [...counts].map(([k, n]) => h('span', { class: `sev sev-${sevKey(k)}`, text: `${n} ${k || '?'}` }))),
      fs.map(f => h('article', { class: `finding f-${sevKey(str(f.severity))}` },
        h('header', {}, h('span', { class: `sev sev-${sevKey(str(f.severity))}`, text: str(f.severity) || '?' }), h('code', { class: 'where', text: str(f.where) })),
        h('p', { text: str(f.issue) }),
        str(f.fix) ? h('p', { class: 'fix' }, h('span', { class: 'fix-k', text: 'Öneri → ' }), str(f.fix)) : null)))
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

function tokenView(t) {
  const rows = [['giriş', t.in], ['çıkış', t.out], ['cache okuma', t.cr], ['cache yazma', t.cw]]
  const max = Math.max(1, ...rows.map(r => r[1]))
  const models = Object.entries(t.models)
  return h('div', { class: 'tok' },
    h('p', { class: 'tok-cost' }, h('b', { class: 'num', text: fmtCost(t.cost) }), h('span', { class: 'muted', text: ` · ${fmtTok(totalTok(t))} token · ${t.n} istek` })),
    h('ul', { class: 'tok-rows' }, rows.map(([k, n]) => h('li', {},
      h('span', { class: 'tk-k', text: k }), h('span', { class: 'tk-bar' }, h('span', { style: `width:${(n / max) * 100}%` })), h('span', { class: 'tk-n num', text: fmtTok(n) })))),
    models.length > 1 ? h('ul', { class: 'mono-list' }, models.map(([m, x]) => h('li', { text: `${model(m)}: ${fmtCost(x.cost)} · ${fmtTok(x.in + x.out + x.cr + x.cw)}` }))) : null)
}

let detailSig = '', detailDur = null
const detailTick = () => {
  const { v } = current(), a = findAgent(v, S.agentId)
  if (a && detailDur) detailDur.textContent = fmtDur(endOf(a, v) - a.startedAt)
}
function renderDetail() {
  const box = $('detail'), { v } = current()
  const a = findAgent(v, S.agentId)
  if (!a) {
    detailSig = ''
    box.hidden = true
    $('scrim').hidden = true
    return
  }
  live.push(detailTick)
  const warns = anomalies(a, v)
  const sig = JSON.stringify([v.id, a, warns])
  if (sig === detailSig) return
  detailSig = sig
  const keep = box.querySelector('.d-body')?.scrollTop ?? 0
  const dur = (detailDur = h('dd', { class: 'num' }))
  const fact = (k, val) => h('div', {}, h('dt', { text: k }), typeof val === 'string' ? h('dd', { text: val }) : val)
  const steps = a.steps.length
    ? h('ol', { class: 'timeline' }, a.steps.map((x, i) => h('li', { class: i === a.steps.length - 1 && (a.status === 'running' || a.status === 'tool' || a.status === 'thinking') ? 'now' : '' },
      h('time', { class: 'num', title: fmtClock(x.t), text: x.t == null ? '?' : `+${fmtOff(x.t - a.startedAt)}` }),
      h('span', { class: 'tl-x', text: x.text }))))
    : h('p', { class: 'muted', text: 'Henüz adım yok.' })
  const run = runOf(v, a)
  const parent = a.parent && a.parent !== 'main' ? findAgent(v, a.parent)?.label ?? a.parent.slice(0, 8) : 'Şef'
  const st = a.main ? h('dd', { class: `st st-${a.status}`, text: MAIN_STATE[a.status] }) : h('dd', { class: `st s-${a.status}`, text: statusText(a.status) })
  const facts = a.main
    ? [fact('Sınıf', 'Şef (orkestratör)'), fact('Model', model(a.model)), fact('Durum', st), fact('Tur', String(a.turns)), fact('Başladı', fmtClock(a.startedAt)), fact('Süre', dur)]
    : [fact('Sınıf', className(a.cls)), fact('Tip', a.agentType || (a.kind === 'wf' ? 'workflow' : '—')), fact('Model', model(a.model)), fact('Durum', st),
      run ? fact('Faz · tur', `${a.phase ?? '—'} · ${a.round}`) : fact('Ebeveyn', parent), fact('Süre', dur)]
  const body = h('div', { class: 'd-body' },
    h('dl', { class: 'facts' }, facts),
    warns.length ? h('div', { class: 'warns' }, warns.map(w => h('p', { text: `⚠ ${w.text}` }))) : null,
    a.main && a.goal ? section('Hedef', h('p', { class: 'res-text', text: a.goal })) : null,
    a.main && a.answer ? section('Son yanıt', h('p', { class: 'res-text', text: a.answer })) : null,
    !a.main && a.hint ? section('Görev', h('p', { class: 'res-text mono', text: a.hint })) : null,
    section('Token ve maliyet', tokenView(a.tokens)),
    section('Araçlar', graphMeter(a.graph), toolBars(a.tools)),
    section('Son adımlar', steps),
    a.main ? null : section('Sonuç', resultView(a.result, a)))
  const close = h('button', { type: 'button', class: 'icon-btn d-close', 'data-k': 'dclose', 'aria-label': 'Detayı kapat', text: '✕', onclick: closeDetail })
  box.className = `detail c-${a.cls} s-${a.status}`
  box.replaceChildren(
    h('div', { class: 'd-grab', 'aria-hidden': 'true' }),
    h('header', { class: 'd-head' }, glyph(a.cls, 32), h('div', { class: 'd-ttl' },
      h('h2', { id: 'd-title', text: a.label }),
      h('p', { class: 'd-sub', text: a.main ? 'orkestratör · ana döngü' : run ? `workflow ${run.name} · ${a.phase ?? '—'} · tur ${a.round}` : `${className(a.cls)} · ${a.agentType || 'alt agent'}` })), close),
    body)
  box.hidden = false
  $('scrim').hidden = false
  body.scrollTop = keep
}
export function openDetail(id) {
  S.agentId = id
  S.pinned = true
  const a = findAgent(current().v, id)
  if (a?.runId) S.tid = a.runId
  api.render()
  $('detail').querySelector('.d-close')?.focus({ preventScroll: true })
}
function closeDetail() {
  const id = S.agentId
  S.agentId = null
  api.render()
  for (const el of document.querySelectorAll('[data-k]')) if (el.dataset.k === `n${id}` || el.dataset.k === `c${id}`) { el.focus({ preventScroll: true }); break }
}
$('scrim').addEventListener('click', closeDetail)
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.agentId && !document.querySelector('.palette:not([hidden])')) closeDetail() })

// ---------- lejant
$('legend').replaceChildren(
  ...['orchestrator', 'ba', 'explore', 'dev', 'review', 'qa', 'design', 'docs', 'ops'].map(c => h('span', { class: `lg c-${c}`, tip: CLASS[c].hint }, glyph(c, 15), CLASS[c].name)),
  h('span', { class: 'lg' }, s('svg', { width: 26, height: 10, 'aria-hidden': 'true' }, s('path', { d: 'M1,5 H25', class: 'lg-edge loop' })), 'geri dönüş'))

// ---------- çizim
export function renderLive() {
  const { v, run } = current()
  if (S.agentId && !findAgent(v, S.agentId)) S.agentId = null
  scanAnomalies(v)
  renderSessbar(v)
  renderOrch(v)
  renderRunPanel(v, run)
  renderGantt(v)
  renderArt(v)
  renderFeed(v)
  renderDetail()
}

// ---------- eserler: commit'ler, PR'lar, değişen dosyalar (kim değiştirdi)
function agentChip(v, id) {
  const a = !id || id === 'main' ? v.main : findAgent(v, id)
  if (!a) return h('span', { class: 'muted small', text: 'agent' })
  return h('button', { type: 'button', class: 'art-by', onclick: () => openDetail(a.id), tip: a.label }, glyph(a.cls, 14), h('span', { text: a.main ? 'Şef' : clip(a.label, 22) }))
}
function commonDir(paths) {
  if (paths.length < 2) return paths[0]?.replace(/[^/]*$/, '') ?? ''
  let pre = paths[0]
  for (const p of paths) while (!p.startsWith(pre)) pre = pre.slice(0, -1)
  return pre.replace(/[^/]*$/, '')
}
function renderArt(v) {
  const box = $('art')
  const a = v?.art
  const n = a ? a.files.length + a.commits.length + a.prs.length : 0
  $('art-panel').hidden = !n
  if (!n) return box.replaceChildren()
  const root = commonDir(a.files.map(f => f.p))
  const maxN = Math.max(1, ...a.files.map(f => f.n))
  box.replaceChildren(
    a.prs.length ? h('div', { class: 'art-sec' }, h('h3', { text: `Pull request · ${a.prs.length}` }), h('ul', { class: 'art-list' }, a.prs.map(x =>
      h('li', {}, h('span', { class: 'art-i pr', 'aria-hidden': 'true', text: '⇡' }), h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', class: 'mono', text: x.url.replace('https://github.com/', '') }), agentChip(v, x.by))))) : null,
    a.commits.length ? h('div', { class: 'art-sec' }, h('h3', { text: `Commit · ${a.commits.length}` }), h('ol', { class: 'art-list' }, a.commits.slice(-30).reverse().map(c =>
      h('li', {}, h('code', { class: 'sha', text: c.sha.slice(0, 7) }), h('span', { class: 'art-msg', text: c.msg, tip: `${c.branch} · ${fmtClock(c.t)}` }), agentChip(v, c.by))))) : null,
    a.files.length ? h('div', { class: 'art-sec' }, h('h3', {}, `Değişen dosya · ${a.files.length}`, root ? h('span', { class: 'art-root', text: ` ${root}` }) : null),
      h('ul', { class: 'art-files' }, a.files.slice(0, 40).map(f =>
        h('li', { tip: `${f.p} · ${f.n} düzenleme` }, h('span', { class: 'af-bar' }, h('i', { style: `width:${(f.n / maxN) * 100}%` })), h('span', { class: 'mono af-p', text: f.p.slice(root.length) || f.p }), h('span', { class: 'af-by' }, f.by.slice(0, 3).map(id => { const ag = id === 'main' ? v.main : findAgent(v, id); return ag ? glyph(ag.cls, 12) : null }))))),
      a.files.length > 40 ? h('p', { class: 'muted small', text: `+${a.files.length - 40} dosya daha` }) : null) : null)
}
