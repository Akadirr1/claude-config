// Otomasyon görünümü: bütçe, "şu olunca → şunu yap" kuralları, günlük özet ve teslim günlüğü.
// Kurallar sunucuda çalışır (panel kapalıyken de); kanal webhook, Slack, Discord ya da ntfy (telefona push).
import { $, h, put, fmtCost, fmtDateTime, arr, num, str, obj } from './util.js'
import { S } from './state.js'

const st = { data: null, draft: null, dirty: false, busy: false, msg: '', err: '' }
const FORMAT_NAMES = { json: 'JSON webhook', slack: 'Slack', discord: 'Discord', ntfy: 'ntfy (telefon)' }
const PRESETS = [
  ['Workflow bitince telefona', { type: 'run_end', status: 'any' }, 'ntfy'],
  ['Agent hata verince', { type: 'agent_failed' }, 'ntfy'],
  ['Günlük bütçenin %80\'i', { type: 'budget', period: 'daily', pct: 80 }, 'ntfy'],
  ['Session $5\'ı geçince', { type: 'session_cost', usd: 5 }, 'slack'],
  ['Agent 10 dk sessiz', { type: 'quiet_agent', min: 10 }, 'discord'],
  ['PR açılınca', { type: 'pr_opened' }, 'ntfy'],
]
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

async function load() {
  st.busy = true
  try {
    const r = await fetch('/api/automations', { credentials: 'same-origin', cache: 'no-store' })
    if (r.status === 401) return void (location.href = '/login')
    if (!r.ok) throw new Error(String(r.status))
    st.data = await r.json()
    if (!st.dirty) st.draft = structuredClone(st.data.settings)
    st.err = ''
  } catch (e) {
    st.err = `Ayarlar alınamadı (${e.message})`
  }
  st.busy = false
  renderAutomations()
}
export const refreshAutomations = () => S.route === 'auto' && !st.busy && !st.dirty && load()

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(str(d.error) || `HTTP ${r.status}`)
  return d
}
async function save() {
  st.msg = 'kaydediliyor…'
  renderAutomations()
  try {
    const d = await post('/api/automations', { ...st.draft, tz: -new Date().getTimezoneOffset() })
    st.draft = structuredClone(d.settings)
    st.dirty = false
    st.msg = '✓ kaydedildi'
    st.err = ''
    await load()
  } catch (e) {
    st.err = e.message
    st.msg = ''
    renderAutomations()
  }
}
async function test(action, out) {
  out.textContent = 'gönderiliyor…'
  try {
    const r = await post('/api/automations/test', action)
    out.textContent = r.ok ? `✓ ulaştı (${r.status})` : `✕ ${r.error || 'HTTP ' + r.status}`
  } catch (e) {
    out.textContent = `✕ ${e.message}`
  }
  load()
}

const touch = (rerender = false) => {
  st.dirty = true
  st.msg = 'kaydedilmemiş değişiklik'
  if (rerender) renderAutomations()
  else { const m = $('auto-msg'); if (m) m.textContent = st.msg }
}
const field = (label, input) => h('label', { class: 'fld' }, h('span', { class: 'fld-k', text: label }), input)
const numIn = (value, set, attrs = {}) => h('input', { type: 'number', inputmode: 'decimal', value: value ?? '', ...attrs, oninput: e => { set(e.target.value === '' ? null : Number(e.target.value)); touch() } })
const select = (value, opts, set, rerender = false) => h('select', { onchange: e => { set(e.target.value); touch(rerender) } },
  opts.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) ? true : null })))

// Bütçe: bugün/bu ay harcama, sınır ve ay sonu tahmini
function meter(label, used, limit, projection) {
  const pct = limit ? used / limit : 0
  const state = !limit ? '' : pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : ''
  const max = Math.max(limit ?? 0, used, projection ?? 0) || 1
  return h('div', { class: `bmeter ${state}` },
    h('div', { class: 'bm-h' }, h('span', { class: 'k', text: label }), h('b', { class: 'num', text: limit ? `${fmtCost(used)} / ${fmtCost(limit)}` : fmtCost(used) }),
      limit ? h('span', { class: 'bm-p num', text: `%${Math.round(pct * 100)}` }) : h('span', { class: 'muted small', text: 'sınır yok' })),
    h('div', { class: 'bm-bar', role: 'img', 'aria-label': `${label}: ${fmtCost(used)}${limit ? ` / ${fmtCost(limit)}` : ''}` },
      projection ? h('i', { class: 'bm-proj', style: `width:${Math.min(100, (projection / max) * 100)}%` }) : null,
      h('i', { class: 'bm-fill', style: `width:${Math.min(100, (used / max) * 100)}%` }),
      limit ? h('i', { class: 'bm-lim', style: `left:${Math.min(100, (limit / max) * 100)}%` }) : null),
    projection ? h('span', { class: 'muted small', text: `ay sonu tahmini ${fmtCost(projection)}${limit && projection > limit ? ' — sınırı aşacak gidiş' : ''}` }) : null)
}
function budgetPanel() {
  const sp = obj(st.data?.spend), b = st.draft.budget
  return h('div', { class: 'budget' },
    meter('bugün', num(sp.today) ?? 0, b.daily),
    meter('bu ay', num(sp.month) ?? 0, b.monthly, num(sp.projection)),
    h('div', { class: 'fld-row' },
      field('Günlük bütçe ($)', numIn(b.daily, v => (b.daily = v), { min: 0, step: 1, placeholder: 'yok' })),
      field('Aylık bütçe ($)', numIn(b.monthly, v => (b.monthly = v), { min: 0, step: 10, placeholder: 'yok' }))),
    h('p', { class: 'muted small', text: 'Bütçe hiçbir şeyi durdurmaz; "bütçe" kurallarıyla seni uyarır. Maliyetler API liste fiyatıyla karşılıktır.' }))
}

function params(r) {
  const t = r.trigger
  const set = k => v => (t[k] = v)
  const out = []
  if (t.type === 'run_end') {
    out.push(field('Durum', select(t.status ?? 'any', [['any', 'her bitiş'], ['done', 'tamamlandı'], ['failed', 'başarısız'], ['stopped', 'durduruldu']], set('status'))))
    out.push(field('Workflow adı', h('input', { type: 'text', value: t.workflow ?? '', placeholder: 'hepsi', oninput: e => { t.workflow = e.target.value; touch() } })))
  }
  if (t.type === 'session_cost' || t.type === 'daily_cost') out.push(field('Eşik ($)', numIn(t.usd ?? 5, set('usd'), { min: 0.01, step: 0.5 })))
  if (t.type === 'budget') {
    out.push(field('Dönem', select(t.period ?? 'daily', [['daily', 'günlük'], ['monthly', 'aylık']], set('period'))))
    out.push(field('Yüzde', select(t.pct ?? 80, [[50, '%50'], [80, '%80'], [100, '%100']], v => (t.pct = Number(v)))))
  }
  if (t.type === 'quiet_agent' || t.type === 'long_run') out.push(field('Dakika', numIn(t.min ?? 10, set('min'), { min: 1, step: 1 })))
  return out
}

function ruleCard(r, i) {
  const triggers = Object.entries(obj(st.data?.triggers))
  const out = h('span', { class: 'muted small test-out', 'aria-live': 'polite' })
  const last = arr(st.data?.deliveries).find(d => d.rule === r.id)
  return h('li', { class: `rule${r.enabled ? '' : ' off'}` },
    h('div', { class: 'rule-h' },
      h('label', { class: 'sw-t' }, h('input', { type: 'checkbox', checked: r.enabled ? true : null, onchange: e => { r.enabled = e.target.checked; touch(true) } }), h('span', { text: r.enabled ? 'açık' : 'kapalı' })),
      h('input', { class: 'rule-name', type: 'text', value: r.name, 'aria-label': 'Kural adı', maxlength: 80, oninput: e => { r.name = e.target.value; touch() } }),
      last ? h('span', { class: `chip ${last.ok ? 'ok' : 'bad'}`, tip: `${fmtDateTime(last.at)} · ${last.title}${last.error ? ' · ' + last.error : ''}`, text: last.ok ? '✓ son teslim' : '✕ son teslim' }) : null),
    h('div', { class: 'rule-b' },
      h('div', { class: 'rule-when' }, h('span', { class: 'rule-k', text: 'ne zaman' }),
        field('Tetikleyici', select(r.trigger.type, triggers, v => (r.trigger = { type: v }), true)), ...params(r)),
      h('div', { class: 'rule-then' }, h('span', { class: 'rule-k', text: 'ne yap' }),
        field('Kanal', select(r.action.format, Object.entries(FORMAT_NAMES), v => (r.action.format = v))),
        field('Adres (https)', h('input', { type: 'url', inputmode: 'url', value: r.action.url, placeholder: r.action.format === 'ntfy' ? 'https://ntfy.sh/gizli-konu-adi' : 'https://…', autocomplete: 'off', spellcheck: 'false', oninput: e => { r.action.url = e.target.value.trim(); touch() } })))),
    h('div', { class: 'rule-f' },
      h('button', { type: 'button', class: 'ghost', onclick: () => test(r.action, out) }, 'Test gönder'),
      h('button', { type: 'button', class: 'ghost danger', onclick: () => { st.draft.rules.splice(i, 1); touch(true) } }, 'Sil'),
      out))
}

function rulesPanel() {
  const rules = st.draft.rules
  return h('div', { class: 'rules-w' },
    rules.length ? h('ol', { class: 'rules' }, rules.map(ruleCard)) : h('p', { class: 'muted', text: 'Henüz kural yok. Bir hazır kalıpla başla:' }),
    h('div', { class: 'presets' }, h('span', { class: 'muted small', text: '+ ekle:' }), PRESETS.map(([name, trigger, format]) =>
      h('button', { type: 'button', class: 'ghost small', onclick: () => { rules.push({ id: uid(), name, enabled: true, trigger: { ...trigger }, action: { url: '', format } }); touch(true) } }, name))))
}

function digestPanel() {
  const d = st.draft.digest
  d.action ??= { url: '', format: 'ntfy' }
  const out = h('span', { class: 'muted small test-out', 'aria-live': 'polite' })
  return h('div', { class: 'digest' },
    h('label', { class: 'sw-t' }, h('input', { type: 'checkbox', checked: d.enabled ? true : null, onchange: e => { d.enabled = e.target.checked; touch(true) } }), h('span', { text: 'Her sabah dünün özetini gönder' })),
    h('div', { class: 'fld-row' },
      field('Saat', select(d.hour, Array.from({ length: 24 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`]), v => (d.hour = Number(v)))),
      field('Kanal', select(d.action.format, Object.entries(FORMAT_NAMES), v => (d.action.format = v))),
      field('Adres (https)', h('input', { type: 'url', inputmode: 'url', value: d.action.url, placeholder: 'https://…', autocomplete: 'off', spellcheck: 'false', oninput: e => { d.action.url = e.target.value.trim(); touch() } }))),
    h('div', { class: 'rule-f' }, h('button', { type: 'button', class: 'ghost', onclick: () => test(d.action, out) }, 'Test gönder'), out),
    h('p', { class: 'muted small', text: 'Özet: dünkü maliyet, session ve agent sayısı, hatalar, graf-önce oranı, en pahalı üç agent ve ay durumu.' }))
}

function log() {
  const xs = arr(st.data?.deliveries).slice(0, 30)
  if (!xs.length) return h('p', { class: 'muted', text: 'Henüz teslim yok.' })
  const names = new Map(arr(st.data?.settings?.rules).map(r => [r.id, r.name]))
  return h('div', { class: 'tbl-w' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['zaman', 'kural', 'mesaj', 'sonuç'].map(x => h('th', { scope: 'col', text: x })))),
    h('tbody', {}, xs.map(d => h('tr', {},
      h('td', { class: 'mono', text: fmtDateTime(d.at) }),
      h('td', { text: d.rule === 'test' ? 'test' : d.rule === 'digest' ? 'günlük özet' : names.get(d.rule) ?? d.rule }),
      h('td', { text: str(d.title) }),
      h('td', { class: d.ok ? 'ok-t' : 'bad-t', text: d.ok ? `✓ ${d.status}` : `✕ ${d.error || d.status}` }))))))
}

const panel = (title, hint, body, cls = '') => h('section', { class: `panel ${cls}` }, h('div', { class: 'phead' }, h('h2', { text: title }), hint ? h('span', { class: 'phint', text: hint }) : null), h('div', { class: 'pbody' }, body))

export function renderAutomations() {
  const box = $('view-auto')
  if (!st.data && !st.busy && !st.err) return void load()
  const head = h('div', { class: 'costs-head' }, h('h1', { class: 'v-title', text: 'Otomasyon' }),
    h('p', { class: 'muted', text: 'Şu olunca → şunu yap. Kurallar sunucuda çalışır; panel kapalıyken de telefonuna, Slack\'e ya da Discord\'a haber verir.' }))
  if (!st.draft) return put(box, head, st.err ? h('p', { class: 'err', text: st.err }) : h('p', { class: 'muted', text: 'yükleniyor…' }))
  put(box, head,
    st.err ? h('p', { class: 'err', role: 'alert', text: st.err }) : null,
    st.data?.writable === false ? h('p', { class: 'warns', text: 'Salt okunur: kuralları kaydetmek için sunucuya ayrı bir WF_VIEW_TOKEN ekle. Tek token\'la cloud ortamındaki push token\'ı da panele girebildiği için yazma kapalı.' }) : null,
    h('div', { class: 'cgrid' },
      panel('Bütçe', 'harcama ve gidiş', budgetPanel()),
      panel('Günlük özet', 'sabah raporu', digestPanel()),
      panel('Kurallar', `${st.draft.rules.length} kural`, rulesPanel(), 'span2'),
      panel('Teslim günlüğü', 'son 30', log(), 'span2')),
    h('div', { class: `savebar${st.dirty ? ' dirty' : ''}` },
      h('span', { id: 'auto-msg', class: 'muted', text: st.msg || (st.data?.publicUrl ? '' : 'İpucu: WF_PUBLIC_URL tanımlarsan bildirimler panele bağlantı taşır.') }),
      st.dirty ? h('button', { type: 'button', class: 'ghost', onclick: () => { st.dirty = false; st.msg = ''; st.draft = structuredClone(st.data.settings); renderAutomations() } }, 'Vazgeç') : null,
      h('button', { type: 'button', class: 'primary', disabled: st.dirty && st.data?.writable !== false ? null : true, onclick: save }, 'Kaydet')))
}
