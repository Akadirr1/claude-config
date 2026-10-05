// Evren: bütün defter tek gökyüzünde. Her session bir yıldız; en eskisi merkezde, yenileri dış kollarda
// (ayçiçeği/altın açı dizilimi). Büyüklük token (ya da $), renk session'da en çok harcayan agent sınıfı.
// Aynı repo'nun session'ları zaman sırasıyla ince bir takımyıldız çizgisiyle bağlanır; çalışanlar nabız atar.
import { $, h, s, put, fmtCost, fmtTok, fmtDateTime, fmtDur, glyph, className, CLASS_ORDER, clsKey, unit, amtOf, amtNum, totalTok } from './util.js'
import { S } from './state.js'

let api = { openSession() {} }
export const initEvren = a => (api = a)
const st = { repo: '' }
const MAX = 800
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

// küçük, tekrarlanabilir rastgele: yıldız tozu her çizimde aynı yerde dursun
function rng(seed) {
  let x = seed >>> 0 || 1
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
function dominant(x) {
  const by = x.totals.byClass
  let best = 'orchestrator', v = -1
  for (const c of CLASS_ORDER) {
    const n = (unit() === 'usd' ? by[c]?.cost : by[c]?.tokens) ?? 0
    if (c !== 'orchestrator' && n > v) (best = c), (v = n)
  }
  return v > 0 ? best : 'orchestrator'
}

export function renderEvren() {
  const box = $('view-evren')
  const all = [...S.index.values()].filter(x => x.startedAt).sort((a, b) => a.startedAt - b.startedAt).slice(-MAX)
  const head = h('div', { class: 'costs-head' }, h('h1', { class: 'v-title', text: 'Evren' }),
    h('p', { class: 'muted', text: all.length ? `${all.length} session · ${fmtTok(all.reduce((n, x) => n + totalTok(x.totals), 0))} token · ${fmtCost(all.reduce((n, x) => n + x.totals.cost, 0))} · merkez en eski, dış kollar en yeni; büyüklük ${unit() === 'usd' ? 'maliyet' : 'token'}` : 'Defter boş; ilk session geldiğinde ilk yıldız doğar.' }))
  if (!all.length) return put(box, head)
  const narrow = innerWidth < 760
  const W = narrow ? 400 : 1000, H = narrow ? 520 : 640, cx = W / 2, cy = H / 2
  const R = Math.min(W, H) / 2 - 24
  const maxCost = Math.max(1e-6, ...all.map(x => amtOf(x.totals)))
  const svg = s('svg', { class: 'evren', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${all.length} session'lık evren haritası` })
  const dust = rng(all.length * 7919)
  for (let i = 0; i < (narrow ? 90 : 220); i++) svg.append(s('circle', { cx: dust() * W, cy: dust() * H, r: dust() * 0.9 + 0.2, class: 'ev-dust' }))
  svg.append(s('circle', { cx, cy, r: R * 0.18, class: 'ev-core' }))
  const pos = all.map((x, i) => {
    const r = R * Math.sqrt((i + 0.5) / all.length)
    const a = i * GOLDEN
    return { x, px: cx + r * Math.cos(a), py: cy + r * Math.sin(a) * (narrow ? 1.25 : 0.82) }
  })
  // takımyıldızlar: aynı repo, zaman sırasıyla
  const byRepo = new Map()
  for (const p of pos) (byRepo.get(p.x.repo) ?? byRepo.set(p.x.repo, []).get(p.x.repo)).push(p)
  for (const [repo, ps] of byRepo) {
    if (ps.length < 2) continue
    const d = ps.map((p, i) => `${i ? 'L' : 'M'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')
    svg.append(s('path', { d, class: `ev-line${st.repo && st.repo !== repo ? ' dim' : st.repo ? ' on' : ''}` }))
  }
  for (const p of pos) {
    const x = p.x
    const cls = clsKey(dominant(x))
    const rad = 1.6 + Math.sqrt(amtOf(x.totals) / maxCost) * (narrow ? 9 : 14)
    const dim = st.repo && st.repo !== x.repo
    const g = s('g', {
      class: `ev-star c-${cls}${x.live ? ' live' : ''}${dim ? ' dim' : ''}`, tabindex: dim ? null : '0', role: 'link',
      'aria-label': `${x.repo}: ${x.title || 'session'}, ${fmtTok(totalTok(x.totals))} token`,
      tip: `${x.repo} · ${fmtDateTime(x.startedAt)} · ${fmtTok(totalTok(x.totals))} token · ${fmtCost(x.totals.cost)} · ${x.totals.agents} agent · ${fmtDur(x.lastAt - x.startedAt)}${x.title ? `\n${x.title.slice(0, 120)}` : ''}`,
      onclick: () => api.openSession(x.id), onkeydown: e => e.key === 'Enter' && api.openSession(x.id),
    },
    s('circle', { cx: p.px, cy: p.py, r: rad * 2.6, class: 'ev-halo' }),
    x.live ? s('circle', { cx: p.px, cy: p.py, r: rad + 4, class: 'ev-pulse' }) : null,
    s('circle', { cx: p.px, cy: p.py, r: rad, class: 'ev-body' }),
    s('circle', { cx: p.px, cy: p.py, r: Math.max(8, rad + 3), class: 'hit' }))
    svg.append(g)
  }
  const repos = [...byRepo.entries()].map(([repo, ps]) => ({ repo, n: ps.length, cost: ps.reduce((n, p) => n + p.x.totals.cost, 0), tok: ps.reduce((n, p) => n + totalTok(p.x.totals), 0) })).sort((a, b) => (unit() === 'usd' ? b.cost - a.cost : b.tok - a.tok))
  const used = new Set(all.map(x => clsKey(dominant(x))))
  put(box, head,
    h('section', { class: 'panel evren-panel' },
      h('div', { class: 'phead' },
        h('div', { class: 'legend' }, CLASS_ORDER.filter(c => used.has(c)).map(c => h('span', { class: `lg c-${c}` }, glyph(c, 14), className(c)))),
        h('span', { class: 'lg' }, h('i', { class: 'ev-k-live', 'aria-hidden': 'true' }), 'çalışıyor')),
      h('div', { class: 'evren-w' }, svg),
      h('div', { class: 'ev-repos', role: 'group', 'aria-label': 'Takımyıldız seç' },
        h('button', { type: 'button', class: 'seg-b', 'aria-pressed': String(!st.repo), onclick: () => { st.repo = ''; renderEvren() } }, 'hepsi'),
        repos.slice(0, 16).map(r => h('button', { type: 'button', class: 'seg-b', 'aria-pressed': String(st.repo === r.repo), onclick: () => { st.repo = st.repo === r.repo ? '' : r.repo; renderEvren() } }, `${r.repo || '?'} · ${r.n} · ${amtNum(r.cost, r.tok)}`)))))
}
