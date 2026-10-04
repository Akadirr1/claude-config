// wf-dashboard paneli: session'daki bütün agentic işi canlı gösterir — Şef (orkestratör), doğurduğu
// agent'lar, workflow devirleri — ve kalıcı defterden maliyet/token analizi yapar.
// Güvenlik: agent'lardan gelen her metin dışarıdan gelir; DOM yalnızca textContent ile kurulur (util.js).
import { $, h, hideTip, motion, fmtCost, fmtAgo, fmtShort, fmtTok, glyph, className, STATUS, RUN_STATUS, str, num, arr, pref, totalTok, clsKey } from './util.js'
import { S, serverNow, setView, setSummary, applyPatch, pickDefault, loadSession, loadNorms, current, newestRun, allAgents, setEventSink } from './state.js'
import { initLive, renderLive, live, openDetail, narrow } from './live.js'
import { initCosts, renderCosts, refreshCosts } from './costs.js'
import { initHistory, renderHistory } from './history.js'
import { renderAutomations, refreshAutomations } from './automations.js'

// ---------- temalar: menüden seçilir, seçim cihazda kalır
const THEMES = [
  ['dark', 'Obsidyen', ['#12110f', '#1b1916', '#ede5d6', '#d95926']],
  ['light', 'Parşömen', ['#f3eee4', '#fffbf3', '#1d1913', '#eb6834']],
  ['kehribar', 'Kehribar CRT', ['#0b0a08', '#12100b', '#ffcf6e', '#ffb000']],
  ['orman', 'Orman', ['#0c120e', '#121a15', '#e6efdf', '#7fd36b']],
  ['gul', 'Gül', ['#120d10', '#1a1317', '#f6e6ee', '#ff7ab8']],
  ['kontrast', 'Yüksek kontrast', ['#000000', '#111111', '#ffffff', '#ffe600']],
]
const themeOk = t => THEMES.some(x => x[0] === t)
function setTheme(t, save) {
  if (!themeOk(t)) t = 'dark'
  document.documentElement.dataset.theme = t
  if (save) pref.set('theme', t)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEMES.find(x => x[0] === t)[2][0])
  const b = $('theme')
  b.setAttribute('aria-label', `Tema: ${THEMES.find(x => x[0] === t)[1]}`)
  b.title = b.getAttribute('aria-label')
}
setTheme(pref.get('theme', 'dark'))
const themeMenu = h('div', { class: 'theme-menu', role: 'menu', hidden: true })
$('theme').after(themeMenu)
function closeThemes(focus) {
  themeMenu.hidden = true
  $('theme').setAttribute('aria-expanded', 'false')
  if (focus) $('theme').focus()
}
$('theme').setAttribute('aria-haspopup', 'menu')
$('theme').addEventListener('click', () => {
  if (!themeMenu.hidden) return closeThemes()
  const cur = document.documentElement.dataset.theme
  themeMenu.replaceChildren(...THEMES.map(([k, name, sw]) => h('button', {
    type: 'button', role: 'menuitemradio', class: 'theme-o', 'aria-checked': String(k === cur),
    onclick: () => { setTheme(k, true); closeThemes(true); render() },
  }, h('span', { class: 'sw', 'aria-hidden': 'true' }, sw.map(c => h('i', { style: `background:${c}` }))), h('span', { class: 'theme-t', text: name }))))
  themeMenu.hidden = false
  $('theme').setAttribute('aria-expanded', 'true')
  themeMenu.querySelector('[aria-checked="true"]')?.focus()
})
themeMenu.addEventListener('keydown', e => {
  const items = [...themeMenu.querySelectorAll('.theme-o')]
  const i = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault() }
  else if (e.key === 'Escape') closeThemes(true)
})
document.addEventListener('click', e => { if (!themeMenu.hidden && !e.target.closest('.theme-menu, #theme')) closeThemes() })

// ---------- yönlendirme: #canli, #maliyet, #gecmis, #otomasyon (session derin bağlantısı: #canli/<sid>)
const ROUTES = { canli: 'live', maliyet: 'costs', gecmis: 'history', otomasyon: 'auto' }
function readHash() {
  const [r, sid] = location.hash.slice(1).split('/')
  S.route = ROUTES[r] ?? 'live'
  if (S.route === 'live' && sid) {
    const id = decodeURIComponent(sid)
    if (id !== S.sid) Object.assign(S, { sid: id, tid: null, pinned: true, agentId: null, replay: null })
  }
}
addEventListener('hashchange', async () => {
  readHash()
  if (S.route === 'live' && S.pinned && S.sid && !S.views.has(S.sid)) await loadSession(S.sid)
  pickDefault()
  render()
})
async function openSession(sid, agentId = null) {
  Object.assign(S, { sid, tid: null, pinned: true, agentId: null, replay: null })
  if (location.hash !== `#canli/${encodeURIComponent(sid)}`) history.pushState(null, '', `#canli/${encodeURIComponent(sid)}`)
  S.route = 'live'
  await loadSession(sid)
  pickDefault()
  if (agentId) {
    S.agentId = agentId
    const a = allAgents(S.views.get(sid)).find(x => x.id === agentId)
    if (a?.runId) S.tid = a.runId
  }
  render()
}

// ---------- seçiciler (yalnız canlı görünümde)
let selSig = ''
function renderPickers() {
  const list = [...S.index.values()].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 60)
  const v = S.views.get(S.sid)
  const runs = v ? [...v.runs].sort((a, b) => b.startedAt - a.startedAt) : []
  const sig = JSON.stringify([S.pinned, S.sid, S.tid, list.map(x => [x.id, x.repo, x.live]), runs.map(r => [r.taskId, r.status])])
  if (sig === selSig) return
  selSig = sig
  const ss = $('sess'), rs = $('run')
  ss.replaceChildren(h('option', { value: '', text: 'otomatik (en yeni)' }),
    ...list.map(x => h('option', { value: x.id, text: `${x.live ? '● ' : ''}${x.repo || 'repo?'} · ${fmtShort(x.receivedAt)} · ${fmtCost(x.totals.cost)}` })))
  rs.replaceChildren(...(runs.length ? runs.map(r => h('option', { value: r.taskId, text: `${r.name} · ${fmtShort(r.startedAt)} · ${STATUS[r.status].i} ${RUN_STATUS[r.status]}` })) : [h('option', { value: '', text: 'workflow yok' })]))
  ss.value = S.pinned ? S.sid ?? '' : ''
  rs.value = S.tid ?? ''
  ss.disabled = !list.length
  rs.disabled = !runs.length
}
$('sess').addEventListener('change', async e => {
  if (e.target.value) return openSession(e.target.value)
  Object.assign(S, { pinned: false, agentId: null, replay: null })
  history.pushState(null, '', '#canli')
  pickDefault()
  render()
})
$('run').addEventListener('change', e => {
  Object.assign(S, { tid: e.target.value, pinned: true, agentId: null, replay: null })
  render()
})

// ---------- başlık: sekmeler ve canlı maliyet sayacı
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', e => {
  e.preventDefault()
  const r = b.dataset.r
  history.pushState(null, '', r === 'canli' && S.pinned && S.sid ? `#canli/${encodeURIComponent(S.sid)}` : `#${r}`)
  readHash()
  render()
})
function renderHeader() {
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-current', ROUTES[b.dataset.r] === S.route ? 'page' : 'false')
  document.body.dataset.route = S.route
  const liveCost = [...S.index.values()].filter(x => x.live).reduce((n, x) => n + x.totals.cost, 0)
  const lives = [...S.index.values()].filter(x => x.live).length
  $('ticker').textContent = lives ? `${lives} canlı · ${fmtCost(liveCost)}` : 'sakin'
  $('ticker').dataset.live = lives ? 'on' : 'off'
}

// ---------- bildirimler: run bitişi, hata, uyarı. Sayfa içi toast her zaman; tarayıcı bildirimi isteğe bağlı.
let notifyOn = pref.get('notify', '0') === '1'
function renderBell() {
  const b = $('bell')
  const ok = 'Notification' in window && Notification.permission === 'granted'
  b.setAttribute('aria-pressed', String(notifyOn && ok))
  b.textContent = notifyOn && ok ? '🔔' : '🔕'
  b.title = notifyOn && ok ? 'Bildirimler açık' : 'Bildirimleri aç'
  b.setAttribute('aria-label', b.title)
}
$('bell').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast({ type: 'warn', icon: '⚠', text: 'Bu tarayıcı bildirim desteklemiyor (iOS: ana ekrana ekle).' })
  if (!notifyOn && Notification.permission !== 'granted') await Notification.requestPermission().catch(() => {})
  notifyOn = !notifyOn && Notification.permission === 'granted'
  pref.set('notify', notifyOn ? '1' : '0')
  renderBell()
})
renderBell()

const toasts = $('toasts')
function toast(ev, sid) {
  const sess = S.index.get(sid)
  const el = h('button', { type: 'button', class: `toast t-${ev.type}`, onclick: () => { el.remove(); if (sid) openSession(sid, ev.agent ?? null) } },
    h('span', { class: 'toast-i', text: ev.icon }),
    h('span', { class: 'toast-x' }, h('b', { text: ev.text }), sess ? h('span', { class: 'muted', text: ` · ${sess.repo}` }) : null))
  toasts.append(el)
  while (toasts.childElementCount > 4) toasts.firstElementChild.remove()
  if (motion()) el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' })
  setTimeout(() => el.remove(), 7000)
}
// yalnız önemli olaylar: run bitişi, hata, uyarı (devirler ve doğumlar akışta kalır)
setEventSink((sid, ev) => {
  const important = ev.runEnd || ev.type === 'error' || ev.type === 'warn'
  if (!important) return
  toast(ev, sid)
  if (notifyOn && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(`wf·akış · ${S.index.get(sid)?.repo ?? ''}`, { body: ev.text, icon: '/favicon.svg', tag: `${sid}${ev.text}` }) } catch {}
  }
})

// ---------- komut paleti (⌘K / Ctrl+K / "/"): session, workflow ve agent'a atla
const pal = $('palette')
const palIn = $('pal-in')
const palList = $('pal-list')
let palItems = [], palSel = 0
function palSearch() {
  const q = palIn.value.trim().toLocaleLowerCase('tr')
  const items = []
  const goView = r => ({ text: r[1], sub: 'görünüm', go: () => { location.hash = '#' + r[0] } })
  for (const r of [['canli', 'Canlı'], ['maliyet', 'Maliyet'], ['gecmis', 'Geçmiş'], ['otomasyon', 'Otomasyon']]) items.push(goView(r))
  for (const x of [...S.index.values()].sort((a, b) => b.receivedAt - a.receivedAt))
    items.push({ text: `${x.repo || 'session'} — ${x.title || x.id.slice(-8)}`, sub: `${fmtAgo(serverNow() - x.receivedAt)} · ${fmtCost(x.totals.cost)}`, go: () => openSession(x.id) })
  for (const v of S.views.values()) {
    for (const r of v.runs) items.push({ text: `workflow ${r.name}`, sub: `${v.repo} · ${RUN_STATUS[r.status]}`, go: () => openSession(v.id).then(() => { S.tid = r.taskId; render() }) })
    for (const a of allAgents(v)) if (!a.main) items.push({ cls: a.cls, text: a.label, sub: `${className(a.cls)} · ${v.repo} · ${fmtCost(a.tokens.cost)}`, go: () => openSession(v.id, a.id) })
  }
  palItems = (q ? items.filter(x => `${x.text} ${x.sub}`.toLocaleLowerCase('tr').includes(q)) : items).slice(0, 40)
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1))
  palList.replaceChildren(...(palItems.length ? palItems.map((x, i) => h('li', { role: 'option', id: `pal-${i}`, 'aria-selected': String(i === palSel), class: i === palSel ? 'on' : '', onclick: () => palGo(i) },
    x.cls ? glyph(x.cls, 16) : h('span', { class: 'pal-dot', 'aria-hidden': 'true' }), h('span', { class: 'pal-t', text: x.text }), h('span', { class: 'pal-s', text: x.sub }))) : [h('li', { class: 'muted pad', text: 'Sonuç yok.' })]))
  palIn.setAttribute('aria-activedescendant', palItems.length ? `pal-${palSel}` : '')
  palList.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
}
function palOpen() {
  pal.hidden = false
  palIn.value = ''
  palSel = 0
  palSearch()
  palIn.focus()
}
function palClose() {
  pal.hidden = true
}
function palGo(i) {
  const x = palItems[i]
  palClose()
  x?.go()
}
palIn.addEventListener('input', () => { palSel = 0; palSearch() })
palIn.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); palSearch(); e.preventDefault() }
  else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); palSearch(); e.preventDefault() }
  else if (e.key === 'Enter') palGo(palSel)
  else if (e.key === 'Escape') palClose()
})
pal.addEventListener('click', e => { if (e.target === pal) palClose() })
$('kbd').addEventListener('click', palOpen)
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); pal.hidden ? palOpen() : palClose() }
})

// ---------- çizim döngüsü
let lastRoute = null
const views = { live: $('view-live'), costs: $('view-costs'), history: $('view-history'), auto: $('view-auto') }
function render() {
  const focusKey = document.activeElement?.dataset?.k
  if (S.route !== lastRoute) hideTip()
  lastRoute = S.route
  live.length = 0
  renderHeader()
  for (const [k, el] of Object.entries(views)) el.hidden = k !== S.route
  $('pickers').hidden = S.route !== 'live'
  if (S.route === 'live') {
    renderPickers()
    renderLive()
  } else if (S.route === 'costs') renderCosts()
  else if (S.route === 'auto') renderAutomations()
  else renderHistory()
  if (focusKey) for (const el of document.querySelectorAll('[data-k]')) if (el.dataset.k === focusKey) { el.focus({ preventScroll: true }); break }
  tick()
}
function tick() {
  for (const f of live) f()
  const v = S.views.get(S.sid)
  $('ago').textContent = v ? `son güncelleme ${fmtAgo(serverNow() - v.receivedAt)}` : 'veri bekleniyor'
}
setInterval(tick, 1000)
narrow.addEventListener('change', () => render())
initLive({ render, openSession })
initCosts({ openSession, openAgent: (sid, id) => openSession(sid, id === 'main' ? 'main' : id) })
initHistory({ openSession })

// ---------- SSE: EventSource kendi deniyorsa bekle; CLOSED olursa önce /api/me, sonra backoff ile yeniden aç
let es = null, retry = 1000, retryTimer = 0
function setConn(state, text) {
  $('conn').dataset.state = state
  $('conn-t').textContent = text
}
const parse = ev => { try { return JSON.parse(ev.data) } catch { return null } }
let costTimer = 0
function connect() {
  clearTimeout(retryTimer)
  es = new EventSource('/events')
  es.onopen = () => { retry = 1000; setConn('on', 'canlı') }
  es.addEventListener('snapshot', ev => {
    const d = parse(ev)
    if (!d) return
    if (num(d.serverNow) != null) S.off = d.serverNow - Date.now()
    for (const x of arr(d.index)) setSummary(x)
    for (const x of arr(d.live)) setView(x, true)
    pickDefault()
    render()
    if (S.pinned && S.sid && !S.views.has(S.sid)) loadSession(S.sid).then(() => { pickDefault(); render() })
  })
  es.addEventListener('session', ev => {
    const d = parse(ev)
    if (!d?.summary) return
    if (num(d.serverNow) != null) S.off = d.serverNow - Date.now()
    const sid = setSummary(d.summary)
    if (!sid) return
    const was = `${S.sid}|${S.tid}`
    // önbellekte görünüm varsa yamayı birleştir; yoksa yeni canlı session: tam görünümü getir
    if (S.views.has(sid)) applyPatch(sid, d.patch)
    else return void loadSession(sid).then(() => { pickDefault(); render() })
    pickDefault()
    if (S.route === 'live' && (sid === S.sid || was !== `${S.sid}|${S.tid}`)) render()
    else {
      renderHeader()
      if (S.route === 'live') renderPickers()
      if (S.route === 'history') renderHistory()
      clearTimeout(costTimer)
      costTimer = setTimeout(refreshCosts, 4000) // maliyet ekranı açıksa seyrek tazele
    }
  })
  // sunucudaki otomasyon kuralı ateşlendi: panel açıksa burada da göster
  es.addEventListener('auto', ev => {
    const d = parse(ev)
    if (!d) return
    toast({ type: 'warn', icon: '⚡', text: `${str(d.title)}${d.body ? ' — ' + str(d.body) : ''}` }, S.index.has(d.session) ? d.session : null)
    refreshAutomations()
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

readHash()
render()
connect()
loadNorms().then(render)
setInterval(() => loadNorms(), 10 * 60e3)
