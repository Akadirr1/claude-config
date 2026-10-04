// Geçmiş: kalıcı defterdeki bütün session'lar. Sıralanabilir tablo, arama; satır canlı görünümde açılır.
import { $, h, put, fmtCost, fmtTok, fmtDur, fmtDateTime, fmtPct, model, str, totalTok, glyph, CLASS_ORDER, className } from './util.js'
import { S } from './state.js'

let api = { openSession() {} }
export const initHistory = a => (api = a)
const st = { sort: 'receivedAt', dir: -1, q: '' }

const COLS = [
  ['receivedAt', 'son etkinlik'], ['repo', 'repo'], ['title', 'hedef'], ['model', 'model'], ['dur', 'süre'],
  ['agents', 'agent'], ['runs', 'run'], ['tokens', 'token'], ['graph', 'graf-önce'], ['cost', 'maliyet'],
]
const val = (x, k) => ({
  dur: x.receivedAt - x.firstAt,
  agents: x.totals.agents,
  runs: x.runs.length,
  tokens: totalTok(x.totals),
  graph: x.totals.graph.g + x.totals.graph.r ? x.totals.graph.g / (x.totals.graph.g + x.totals.graph.r) : -1,
  cost: x.totals.cost,
})[k] ?? x[k]

// sınıf karışımı: session'ın maliyetinin sınıflara dağılımı (ince yığılmış şerit)
function mix(x) {
  const by = x.totals.byClass
  const tot = Object.values(by).reduce((n, c) => n + c.cost, 0)
  if (!tot) return null
  return h('span', { class: 'mix', tip: CLASS_ORDER.filter(c => by[c]?.cost).map(c => `${className(c)} ${fmtCost(by[c].cost)}`).join(' · ') },
    CLASS_ORDER.filter(c => by[c]?.cost).map(c => h('i', { class: `c-${c}`, style: `flex-grow:${by[c].cost / tot}` })))
}

export function renderHistory() {
  const box = $('view-history')
  const q = st.q.toLocaleLowerCase('tr')
  const rows = [...S.index.values()]
    .filter(x => !q || `${x.repo} ${x.title} ${x.model} ${x.runs.map(r => r.name).join(' ')}`.toLocaleLowerCase('tr').includes(q))
    .sort((a, b) => {
      const x = val(a, st.sort), y = val(b, st.sort)
      return (typeof x === 'string' ? x.localeCompare(y, 'tr') : x - y) * st.dir
    })
  const total = rows.reduce((n, x) => n + x.totals.cost, 0)
  const search = h('input', { type: 'search', class: 'search', placeholder: 'repo, hedef, workflow ara…', value: st.q, 'aria-label': 'Session ara', oninput: e => { st.q = e.target.value; renderHistory(); $('view-history').querySelector('.search')?.focus() } })
  put(box,
    h('div', { class: 'costs-head' },
      h('h1', { class: 'v-title', text: 'Geçmiş' }),
      h('p', { class: 'muted', text: `${rows.length} session · toplam ${fmtCost(total)} · kalıcı defterden` }),
      h('div', { class: 'ctl' }, search, h('a', { class: 'ghost link', href: '/api/export.csv?days=0', download: 'wf-defter.csv' }, '⇩ CSV defter'))),
    rows.length ? h('div', { class: 'panel' }, h('div', { class: 'tbl-w' }, h('table', { class: 'tbl hist' },
      h('thead', {}, h('tr', {}, COLS.map(([k, label]) => h('th', { scope: 'col', 'aria-sort': st.sort === k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', { type: 'button', class: 'th-b', onclick: () => { st.dir = st.sort === k ? -st.dir : -1; st.sort = k; renderHistory() } }, label, st.sort === k ? (st.dir > 0 ? ' ↑' : ' ↓') : ''))))),
      h('tbody', {}, rows.map(x => h('tr', { tabindex: '0', class: 'clickable', onclick: () => api.openSession(x.id), onkeydown: e => e.key === 'Enter' && api.openSession(x.id) },
        h('td', { class: 'num nowrap' }, x.live ? h('span', { class: 'live-dot', tip: 'şu an çalışıyor' }) : null, fmtDateTime(x.receivedAt)),
        h('td', { class: 'mono', text: x.repo || '—' }),
        h('td', { class: 'goal' }, h('span', { class: 'goal-t', text: x.title || '—' }), mix(x)),
        h('td', { class: 'mono', text: model(x.model) }),
        h('td', { class: 'num', text: fmtDur(x.receivedAt - x.firstAt) }),
        h('td', { class: 'num', text: String(x.totals.agents) }),
        h('td', { class: 'num', text: String(x.runs.length) }),
        h('td', { class: 'num', text: fmtTok(totalTok(x.totals)) }),
        h('td', { class: 'num', text: val(x, 'graph') < 0 ? '—' : fmtPct(val(x, 'graph')) }),
        h('td', { class: 'num strong', text: fmtCost(x.totals.cost) }))))))) :
      h('div', { class: 'empty' }, h('p', { class: 'empty-t', text: 'Defter boş' }), h('p', { text: 'Cloud session\'larda çalışan her şey burada kalıcı olarak birikir.' })))
}
export { glyph }
