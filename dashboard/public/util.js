// Ortak yardımcılar. Güvenlik: agent'lardan gelen her metin dışarıdan gelir. DOM yalnızca
// createElement(NS) + textContent ile kurulur; sınıf adına giren değerler beyaz listeden geçer.
import { CLASSES, CLASS } from './classes.js'
import { shortModel } from './pricing.js'

export const $ = id => document.getElementById(id)
const SVGNS = 'http://www.w3.org/2000/svg'
export const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches

function attrs(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'text') el.textContent = v
    else if (k === 'onclick') el.addEventListener('click', v)
    else if (k === 'oninput') el.addEventListener('input', v)
    else if (k === 'onchange') el.addEventListener('change', v)
    else if (k === 'onkeydown') el.addEventListener('keydown', v)
    else if (k === 'tip') el.dataset.tip = v
    // CSP style-src 'self': style özniteliği yazılmaz, CSSOM ile atanır
    else if (k === 'style') el.style.cssText = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  return el
}
export function h(tag, props = {}, ...kids) {
  const el = attrs(document.createElement(tag), props)
  el.append(...kids.flat(9).filter(k => k != null && k !== false))
  return el
}
// replaceChildren null/false'u metin olarak yazar; bu süzer
export const put = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter(k => k != null && k !== false))
export function s(tag, props = {}, ...kids) {
  const el = attrs(document.createElementNS(SVGNS, tag), props)
  el.append(...kids.flat(9).filter(k => k != null && k !== false))
  return el
}

// ---- gelen veriyi düzle (şekil bozuksa kırılmasın)
export const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const arr = v => (Array.isArray(v) ? v : [])
export const str = v => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
export const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
// Bozuk tek bir öğe listenin geri kalanını düşürmesin; f null dönerse öğe atlanır.
export const each = (xs, f) => arr(xs).flatMap(x => { try { const v = f(x); return v == null ? [] : [v] } catch { return [] } })

export const clsKey = c => (typeof c === 'string' && Object.hasOwn(CLASS, c) ? c : 'other')
export const STATUS = {
  running: { t: 'çalışıyor', i: '●' },
  done: { t: 'bitti', i: '✓' },
  failed: { t: 'hata', i: '✕' },
  stopped: { t: 'durduruldu', i: '■' },
}
export const stKey = x => (typeof x === 'string' && Object.hasOwn(STATUS, x) ? x : 'stopped')
export const RUN_STATUS = { running: 'sürüyor', done: 'tamamlandı', failed: 'başarısız', stopped: 'durduruldu' }
export const MAIN_STATE = { idle: 'boşta', thinking: 'düşünüyor', tool: 'araç kullanıyor' }
export const mainKey = x => (typeof x === 'string' && Object.hasOwn(MAIN_STATE, x) ? x : 'idle')
export const statusText = st => `${STATUS[st].i} ${STATUS[st].t}`

// ---- biçimlendirme
const pad = n => String(n).padStart(2, '0')
export function fmtDur(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(sec / 60), hr = Math.floor(m / 60)
  return hr ? `${hr}sa ${pad(m % 60)}dk` : m ? `${m}dk ${pad(sec % 60)}sn` : `${sec}sn`
}
export const fmtClock = t => (Number.isFinite(t) ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--')
export const fmtShort = t => (Number.isFinite(t) ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '--:--')
export const fmtDate = t => (Number.isFinite(t) ? new Date(t).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) : '—')
export const fmtDateTime = t => (Number.isFinite(t) ? `${fmtDate(t)} ${fmtShort(t)}` : '—')
export const fmtOff = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}` : `${Math.floor(sec / 60)}:${pad(sec % 60)}` }
export function fmtAgo(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return sec < 5 ? 'az önce' : sec < 60 ? `${sec} sn önce` : sec < 3600 ? `${Math.floor(sec / 60)} dk önce` : sec < 86400 ? `${Math.floor(sec / 3600)} sa önce` : `${Math.floor(sec / 86400)} gün önce`
}
export function fmtCost(v) {
  const x = num(v) ?? 0
  if (x === 0) return '$0'
  if (x < 0.01) return '<$0.01'
  if (x < 10) return '$' + x.toFixed(2)
  if (x < 1000) return '$' + x.toFixed(1)
  return '$' + Math.round(x).toLocaleString('tr-TR')
}
export function fmtTok(v) {
  const n = num(v) ?? 0
  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n))
}
export const fmtPct = v => `${Math.round((num(v) ?? 0) * 100)}%`
export const model = m => (m ? shortModel(m) : '—')
export const totalTok = t => (t ? t.in + t.out + t.cr + t.cw : 0)

// ---- birim: varsayılan token (giriş + çıkış + cache okuma + cache yazma); $ isteğe bağlı
export const TOK_KINDS = [['in', 'giriş'], ['cw', 'cache yazma'], ['cr', 'cache okuma'], ['out', 'çıkış']]
let unitNow = (() => { try { return localStorage.getItem('wf-unit') === 'usd' ? 'usd' : 'tok' } catch { return 'tok' } })()
export const unit = () => unitNow
export function setUnit(u) {
  unitNow = u === 'usd' ? 'usd' : 'tok'
  try { localStorage.setItem('wf-unit', unitNow) } catch {}
}
// t: { in, out, cr, cw, cost } — seçili birimde tek değer ve biçimli metin
export const amtOf = t => (unitNow === 'usd' ? num(t?.cost) ?? 0 : totalTok(t))
export const amt = t => (unitNow === 'usd' ? fmtCost(t?.cost) : fmtTok(totalTok(t)))
export const amtNum = (cost, tok) => (unitNow === 'usd' ? fmtCost(cost) : fmtTok(tok))
export const tokTip = t => TOK_KINDS.map(([k, n]) => `${n} ${fmtTok(t?.[k])}`).join(' · ') + ` · ${fmtCost(t?.cost)}`
export const tokLegend = () => h('span', { class: 'tk-legend' }, TOK_KINDS.map(([k, n]) => h('span', { class: 'lg' }, h('i', { class: `tk-sw tk-${k}`, 'aria-hidden': 'true' }), n)))
// İnce yığılmış şerit: giriş / cache yazma / cache okuma / çıkış (sabit sıra, 1px boşluk)
export function tokBar(t, cls = '') {
  const tot = totalTok(t)
  return h('span', { class: `tokbar ${cls}`, role: 'img', 'aria-label': tokTip(t), tip: tokTip(t) },
    tot ? TOK_KINDS.filter(([k]) => t[k] > 0).map(([k]) => h('i', { class: `tk-${k}`, style: `flex-grow:${t[k] / tot}` })) : null)
}

// ---- sınıf glifleri
const SHAPES = {
  star: ['polygon', { points: '13,0.8 16.2,9.3 25.2,9.5 18.1,15.1 20.6,23.9 13,18.8 5.4,23.9 7.9,15.1 0.8,9.5 9.8,9.3' }],
  diamond: ['polygon', { points: '13,1 25,13 13,25 1,13' }],
  hex: ['polygon', { points: '13,1 24,7 24,19 13,25 2,19 2,7' }],
  circle: ['circle', { cx: 13, cy: 13, r: 12 }],
  square: ['rect', { x: 2, y: 2, width: 22, height: 22, rx: 4 }],
  triangle: ['polygon', { points: '13,1.5 25.5,24.5 0.5,24.5' }],
  pentagon: ['polygon', { points: '13,1 25,10 20.4,24.5 5.6,24.5 1,10' }],
  doc: ['path', { d: 'M4,1 H17 L23,7 V25 H4 Z' }],
  gear: ['path', { d: 'M11,1 H15 L15.8,4.2 18.6,5.4 21.4,3.6 24.2,6.4 22.4,9.2 23.6,12 25,13 V15 L23.6,15.8 22.4,18.6 24.2,21.4 21.4,24.2 18.6,22.4 15.8,23.6 15,25 H11 L10.2,23.6 7.4,22.4 4.6,24.2 1.8,21.4 3.6,18.6 2.4,15.8 1,15 V11 L2.4,10.2 3.6,7.4 1.8,4.6 4.6,1.8 7.4,3.6 10.2,2.4 Z' }],
  dot: ['circle', { cx: 13, cy: 13, r: 9 }],
}
const LETTER_Y = { triangle: 20.5, star: 16.5, pentagon: 18 }
export function glyph(cls, size = 26) {
  const c = CLASS[clsKey(cls)]
  const [tag, at] = SHAPES[c.shape] ?? SHAPES.dot
  return s('svg', { class: `glyph c-${c.key}`, viewBox: '0 0 26 26', width: size, height: size, 'aria-hidden': 'true' },
    s(tag, { ...at, class: 'g-shape' }),
    s('text', { x: 13, y: LETTER_Y[c.shape] ?? 17.5, 'text-anchor': 'middle', class: 'g-letter', text: c.letter }))
}
export const className = c => CLASS[clsKey(c)].name
export { CLASSES, CLASS }

// Sabit sıra (doğrulanmış palet sırası): grafiklerde renk sınıfa bağlı, sıralamaya değil
export const CLASS_ORDER = ['qa', 'ba', 'dev', 'docs', 'review', 'design', 'explore', 'ops', 'other', 'orchestrator']

// ---- araç ipucu (grafikler ve küçük işaretler için; metin textContent ile)
const tipEl = h('div', { class: 'tip', role: 'tooltip', hidden: true })
document.body.append(tipEl)
function showTip(e) {
  const t = e.target.closest?.('[data-tip]')
  if (!t) return void (tipEl.hidden = true)
  tipEl.textContent = t.dataset.tip
  tipEl.hidden = false
  const x = Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8)
  const y = e.clientY + 16 + tipEl.offsetHeight > innerHeight ? e.clientY - tipEl.offsetHeight - 10 : e.clientY + 16
  tipEl.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`
}
document.addEventListener('pointermove', showTip)
document.addEventListener('pointerdown', showTip)
document.addEventListener('scroll', () => (tipEl.hidden = true), true)
export const hideTip = () => (tipEl.hidden = true)
document.addEventListener('focusin', e => {
  const t = e.target.closest?.('[data-tip]')
  if (!t) return void (tipEl.hidden = true)
  const r = t.getBoundingClientRect()
  tipEl.textContent = t.dataset.tip
  tipEl.hidden = false
  tipEl.style.transform = `translate(${Math.max(8, Math.min(r.left, innerWidth - tipEl.offsetWidth - 8))}px, ${r.bottom + 8}px)`
})

// ---- yerel ayar (yalnız kolaylık: tema, bildirim, son görünüm)
export const pref = {
  get(k, d) { try { const v = localStorage.getItem('wf-' + k); return v == null ? d : v } catch { return d } },
  set(k, v) { try { localStorage.setItem('wf-' + k, v) } catch {} },
}
