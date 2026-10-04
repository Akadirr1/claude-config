// Otomasyonlar: "şu olunca → şunu yap". Kurallar ve bütçe data/settings.json'da kalıcıdır.
// Tetikleyiciler push'larda (görünüm farkından) ve dakikalık saatte değerlendirilir; eylem webhook'tur
// (JSON, Slack, Discord, ntfy). SSRF: yalnız https, iç ağ/loopback/link-local adreslere gönderim yok.
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_RULES = 50
const LOG_MAX = 100
const MIN_GAP_MS = 10_000 // aynı kural en sık 10 sn'de bir
const DAY = 86400e3

export const TRIGGERS = {
  run_end: 'Workflow bitince',
  agent_failed: 'Bir agent hata verince',
  session_cost: 'Session maliyeti eşiği geçince',
  daily_cost: 'Günlük maliyet eşiği geçince',
  budget: 'Bütçenin bir yüzdesi aşılınca',
  quiet_agent: 'Agent N dakika sessiz kalınca',
  long_run: 'Workflow N dakikayı geçince',
  pr_opened: 'PR açılınca',
}
export const FORMATS = ['json', 'slack', 'discord', 'ntfy']

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const num = (v, d = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '')

// ---- ayar doğrulama: dışarıdan gelen JSON yalnız bilinen alanlarla, sınırlı boyutta kabul edilir
function cleanAction(a) {
  if (!isObj(a)) throw new Error('eylem yok')
  const url = str(a.url, 500)
  let u
  try {
    u = new URL(url)
  } catch {
    throw new Error('geçersiz URL')
  }
  if (u.protocol !== 'https:') throw new Error('yalnız https adresleri')
  if (u.username || u.password) throw new Error('URL içinde kullanıcı bilgisi olmasın')
  const format = FORMATS.includes(a.format) ? a.format : 'json'
  return { type: 'webhook', url: u.href, format }
}
function cleanTrigger(t) {
  if (!isObj(t) || !Object.hasOwn(TRIGGERS, t.type)) throw new Error('geçersiz tetikleyici')
  const out = { type: t.type }
  if (t.type === 'run_end') {
    out.status = ['any', 'done', 'failed', 'stopped'].includes(t.status) ? t.status : 'any'
    out.workflow = str(t.workflow, 80)
  }
  if (t.type === 'session_cost' || t.type === 'daily_cost') out.usd = Math.max(0.01, Math.min(100000, num(t.usd, 5)))
  if (t.type === 'budget') {
    out.period = t.period === 'monthly' ? 'monthly' : 'daily'
    out.pct = [50, 80, 100].includes(t.pct) ? t.pct : 80
  }
  if (t.type === 'quiet_agent' || t.type === 'long_run') out.min = Math.max(1, Math.min(1440, Math.round(num(t.min, 10))))
  if (isObj(t) && typeof t.repo === 'string') out.repo = str(t.repo, 200)
  return out
}
export function cleanSettings(raw) {
  if (!isObj(raw)) throw new Error('ayar nesnesi bekleniyor')
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).slice(0, MAX_RULES).map((r, i) => {
    if (!isObj(r)) throw new Error(`kural ${i + 1}: nesne bekleniyor`)
    try {
      return {
        id: /^[a-z0-9-]{1,40}$/i.test(r.id ?? '') ? r.id : `r${Date.now().toString(36)}${i}`,
        name: str(r.name, 80) || TRIGGERS[r.trigger?.type] || 'kural',
        enabled: r.enabled !== false,
        trigger: cleanTrigger(r.trigger),
        action: cleanAction(r.action),
      }
    } catch (e) {
      throw new Error(`kural ${i + 1}: ${e.message}`)
    }
  })
  const b = isObj(raw.budget) ? raw.budget : {}
  const budget = { daily: num(b.daily) && b.daily > 0 ? Math.min(1e6, b.daily) : null, monthly: num(b.monthly) && b.monthly > 0 ? Math.min(1e7, b.monthly) : null }
  const d = isObj(raw.digest) ? raw.digest : {}
  const digest = { enabled: d.enabled === true, hour: Math.max(0, Math.min(23, Math.round(num(d.hour, 9)))), action: null }
  if (d.enabled === true || isObj(d.action)) {
    try {
      digest.action = cleanAction(d.action)
    } catch (e) {
      if (digest.enabled) throw new Error(`günlük özet: ${e.message}`)
    }
  }
  const tz = Math.max(-840, Math.min(840, Math.round(num(raw.tz, 0))))
  return { rules, budget, digest, tz }
}

// ---- SSRF: hedef ad özel/iç adrese çözülüyorsa gönderme
function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const x = ip.toLowerCase()
  if (x.startsWith('::ffff:')) {
    const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x.slice(7)) // URL'ler eşlenmiş IPv4'ü onaltılık yazar
    return privateIp(m ? [parseInt(m[1], 16) >> 8, parseInt(m[1], 16) & 255, parseInt(m[2], 16) >> 8, parseInt(m[2], 16) & 255].join('.') : x.slice(7))
  }
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb')
}
// ponytail: çözüm ile fetch arasında DNS yeniden bağlama (rebinding) mümkün; gerekirse undici Agent ile IP sabitlenir.
export async function safeTarget(url, resolve = lookup) {
  const u = new URL(url)
  if (u.protocol !== 'https:') return false
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => [])
  return addrs.length > 0 && !addrs.some(a => privateIp(a.address))
}

// ---- mesaj biçimleri
export function payload(format, msg) {
  const text = `${msg.title}${msg.body ? ' — ' + msg.body : ''}`
  if (format === 'slack') return { body: JSON.stringify({ text: msg.link ? `${text}\n<${msg.link}|Panelde aç>` : text }), headers: { 'Content-Type': 'application/json' } }
  if (format === 'discord') return { body: JSON.stringify({ content: msg.link ? `${text}\n${msg.link}` : text }), headers: { 'Content-Type': 'application/json' } }
  if (format === 'ntfy') {
    // başlıklar yalnız ASCII taşır: başlık gövdeye, etiket başlığa
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', Tags: msg.tag ?? 'robot' }
    if (msg.link) headers.Click = msg.link
    return { body: text, headers }
  }
  return { body: JSON.stringify({ event: msg.event, title: msg.title, body: msg.body, link: msg.link ?? null, session: msg.session ?? null, at: msg.at }), headers: { 'Content-Type': 'application/json' } }
}

const dayKey = (t, tz) => new Date(t + tz * 60000).toISOString().slice(0, 10)
const monthKey = (t, tz) => dayKey(t, tz).slice(0, 7)
const fmt = v => (v < 10 ? '$' + v.toFixed(2) : '$' + v.toFixed(1))

// Dönemin harcaması: bugünün ve bu ayın toplamı (agent başlangıç zamanına göre)
export function spend(rows, now, tz) {
  const d = dayKey(now, tz), m = monthKey(now, tz)
  let today = 0, month = 0
  for (const r of rows) {
    const t = r.start || r.end
    if (!t) continue
    const k = dayKey(t, tz)
    if (k === d) today += r.cost
    if (k.slice(0, 7) === m) month += r.cost
  }
  const local = new Date(now + tz * 60000)
  const daysIn = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate()
  const elapsed = local.getUTCDate() - 1 + (local.getUTCHours() * 60 + local.getUTCMinutes()) / 1440
  return { today, month, projection: elapsed > 0.25 ? (month / elapsed) * daysIn : month, daysIn }
}

export function createAutomations({ dataDir, now = Date.now, send = globalThis.fetch, resolve = lookup, publicUrl = '', log = () => {}, onFire = () => {} } = {}) {
  const file = dataDir ? join(dataDir, 'settings.json') : null
  let settings = { rules: [], budget: { daily: null, monthly: null }, digest: { enabled: false, hour: 9, action: null }, tz: 0 }
  let fired = {} // dedup anahtarı -> zaman (yeniden başlatmada da tekrar ateşlenmesin)
  const deliveries = []
  const lastSent = new Map()
  if (file) {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'))
      settings = cleanSettings(d.settings ?? d)
      fired = isObj(d.fired) ? d.fired : {}
      if (Array.isArray(d.deliveries)) deliveries.push(...d.deliveries.slice(-LOG_MAX))
    } catch {}
  }
  const save = () => {
    if (!file) return
    const t = now()
    for (const [k, v] of Object.entries(fired)) if (t - v > 40 * DAY) delete fired[k]
    try {
      writeFileSync(file + '.tmp', JSON.stringify({ settings, fired, deliveries }))
      renameSync(file + '.tmp', file)
    } catch (e) {
      log(`ayarlar yazılamadı: ${e.message}`)
    }
  }
  const link = sid => (publicUrl ? `${publicUrl.replace(/\/+$/, '')}/#canli/${encodeURIComponent(sid)}` : null)

  async function deliver(action, msg, ruleId) {
    const at = now()
    const entry = { at, rule: ruleId, title: msg.title, ok: false, status: 0, error: '' }
    try {
      if (!(await safeTarget(action.url, resolve))) throw new Error('hedef iç ağda ya da çözülemedi')
      const { body, headers } = payload(action.format, msg)
      const headersOut = action.format === 'ntfy' ? { ...headers, Title: asciiTitle(msg.title) } : headers
      const res = await send(action.url, { method: 'POST', headers: headersOut, body, redirect: 'error', signal: AbortSignal.timeout(8000) })
      entry.status = res.status
      entry.ok = res.ok
    } catch (e) {
      entry.error = str(e.message, 160)
    }
    deliveries.push(entry)
    while (deliveries.length > LOG_MAX) deliveries.shift()
    save()
    return entry
  }

  function fire(rule, key, msg) {
    if (!rule.enabled || fired[key]) return
    const t = now()
    if (t - (lastSent.get(rule.id) ?? 0) < MIN_GAP_MS) return
    lastSent.set(rule.id, t)
    fired[key] = t
    msg.at = t
    onFire({ rule: rule.name, ...msg })
    return deliver(rule.action, msg, rule.id)
  }

  const repoOk = (rule, repo) => !rule.trigger.repo || rule.trigger.repo === repo

  return {
    get: () => ({ settings, deliveries: deliveries.slice().reverse(), triggers: TRIGGERS, formats: FORMATS }),
    set(raw) {
      settings = cleanSettings(raw)
      save()
      return settings
    },
    test: action => deliver(cleanAction(action), { event: 'test', title: 'wf·akış test bildirimi', body: 'Bu kanal çalışıyor.', link: publicUrl || null, tag: 'white_check_mark' }, 'test'),

    // push sonrası: önceki ve yeni görünümün farkı
    async onIngest(prev, v, allRows) {
      const jobs = []
      const was = new Map((prev?.runs ?? []).map(r => [r.taskId, r]))
      const wasAgents = new Map([...(prev?.subs ?? []), ...(prev?.runs ?? []).flatMap(r => r.agents)].map(a => [a.id, a.status]))
      for (const rule of settings.rules) {
        if (!repoOk(rule, v.repo)) continue
        const tr = rule.trigger
        if (tr.type === 'run_end')
          for (const r of v.runs) {
            if (r.status === 'running' || was.get(r.taskId)?.status === r.status) continue
            if (tr.status !== 'any' && tr.status !== r.status) continue
            if (tr.workflow && tr.workflow !== r.name) continue
            const cost = r.agents.reduce((n, a) => n + a.tokens.cost, 0)
            const icon = { done: '✓', failed: '✕', stopped: '■' }[r.status]
            jobs.push(fire(rule, `${rule.id}:run:${r.taskId}:${r.status}`, { event: 'run_end', title: `${icon} ${r.name} ${({ done: 'tamamlandı', failed: 'başarısız', stopped: 'durduruldu' })[r.status]}`, body: `${v.repo} · ${r.agents.length} agent · ${fmt(cost)}`, link: link(v.id), session: v.id, tag: r.status === 'done' ? 'white_check_mark' : 'x' }))
          }
        if (tr.type === 'agent_failed')
          for (const a of [...v.subs, ...v.runs.flatMap(r => r.agents)])
            if (a.status === 'failed' && wasAgents.get(a.id) !== 'failed')
              jobs.push(fire(rule, `${rule.id}:fail:${a.id}`, { event: 'agent_failed', title: `✕ ${a.label} hata verdi`, body: `${v.repo} · ${a.cls}`, link: link(v.id), session: v.id, tag: 'x' }))
        if (tr.type === 'pr_opened') {
          const had = new Set((prev?.art?.prs ?? []).map(x => x.url))
          for (const x of v.art?.prs ?? [])
            if (!had.has(x.url))
              jobs.push(fire(rule, `${rule.id}:pr:${x.url}`, { event: 'pr_opened', title: `⇡ PR açıldı: ${x.url.replace('https://github.com/', '')}`, body: `${v.repo} · ${fmt(v.totals.cost)} harcandı`, link: x.url, session: v.id, tag: 'rocket' }))
        }
        if (tr.type === 'session_cost' && v.totals.cost >= tr.usd && (prev?.totals.cost ?? 0) < tr.usd)
          jobs.push(fire(rule, `${rule.id}:scost:${v.id}`, { event: 'session_cost', title: `$ session ${fmt(tr.usd)} eşiğini geçti`, body: `${v.repo} · şu an ${fmt(v.totals.cost)}`, link: link(v.id), session: v.id, tag: 'money_with_wings' }))
      }
      jobs.push(this.checkSpend(allRows))
      return Promise.all(jobs)
    },

    // günlük maliyet ve bütçe eşikleri: push'ta ve dakikalık saatte
    checkSpend(allRows) {
      const t = now()
      const sp = spend(allRows, t, settings.tz)
      const d = dayKey(t, settings.tz), m = monthKey(t, settings.tz)
      const jobs = []
      for (const rule of settings.rules) {
        const tr = rule.trigger
        if (tr.type === 'daily_cost' && sp.today >= tr.usd)
          jobs.push(fire(rule, `${rule.id}:daily:${d}`, { event: 'daily_cost', title: `$ bugün ${fmt(tr.usd)} eşiği geçildi`, body: `bugün ${fmt(sp.today)}`, link: publicUrl ? `${publicUrl.replace(/\/+$/, '')}/#maliyet` : null, tag: 'money_with_wings' }))
        if (tr.type === 'budget') {
          const limit = settings.budget[tr.period]
          const used = tr.period === 'monthly' ? sp.month : sp.today
          if (limit && used >= (limit * tr.pct) / 100)
            jobs.push(fire(rule, `${rule.id}:budget:${tr.period === 'monthly' ? m : d}:${tr.pct}`, { event: 'budget', title: `⚠ ${tr.period === 'monthly' ? 'aylık' : 'günlük'} bütçenin %${tr.pct}'i aşıldı`, body: `${fmt(used)} / ${fmt(limit)}${tr.period === 'monthly' ? ` · ay sonu tahmini ${fmt(sp.projection)}` : ''}`, link: publicUrl ? `${publicUrl.replace(/\/+$/, '')}/#maliyet` : null, tag: 'warning' }))
        }
      }
      return Promise.all(jobs)
    },

    // dakikalık saat: sessiz agent, uzun run, günlük özet
    tick(views, allRows) {
      const t = now()
      const jobs = [this.checkSpend(allRows)]
      for (const rule of settings.rules) {
        const tr = rule.trigger
        for (const v of views) {
          if (!repoOk(rule, v.repo)) continue
          const at = v.sentAt + (t - v.receivedAt) // mod saatine göre şimdi
          if (tr.type === 'quiet_agent')
            for (const a of [...v.subs, ...v.runs.flatMap(r => r.agents)]) {
              if (a.status !== 'running') continue
              const last = Math.max(a.startedAt ?? 0, ...(a.steps ?? []).map(x => x.t ?? 0))
              if (at - last >= tr.min * 60e3)
                jobs.push(fire(rule, `${rule.id}:quiet:${a.id}:${last}`, { event: 'quiet_agent', title: `⏸ ${a.label} ${tr.min} dk'dır sessiz`, body: v.repo, link: link(v.id), session: v.id, tag: 'hourglass' }))
            }
          if (tr.type === 'long_run')
            for (const r of v.runs)
              if (r.status === 'running' && at - r.startedAt >= tr.min * 60e3)
                jobs.push(fire(rule, `${rule.id}:long:${r.taskId}`, { event: 'long_run', title: `⏱ ${r.name} ${tr.min} dk'yı geçti`, body: v.repo, link: link(v.id), session: v.id, tag: 'hourglass' }))
        }
      }
      const dg = settings.digest
      const local = new Date(t + settings.tz * 60000)
      if (dg.enabled && dg.action && local.getUTCHours() === dg.hour) {
        const key = `digest:${dayKey(t, settings.tz)}`
        if (!fired[key]) {
          fired[key] = t
          jobs.push(deliver(dg.action, digest(allRows, t, settings), 'digest'))
        }
      }
      return Promise.all(jobs)
    },
  }
}

const asciiTitle = s => String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 120) || 'wf-akis'

// Günlük özet: dünün özeti + ay durumu, şablonla (LLM gerekmez)
export function digest(rows, now, settings) {
  const tz = settings.tz
  const y = dayKey(now - DAY, tz)
  const day = rows.filter(r => dayKey(r.start || r.end, tz) === y)
  const cost = day.reduce((n, r) => n + r.cost, 0)
  const sessions = new Set(day.map(r => r.sid)).size
  const agents = day.filter(r => r.kind !== 'main')
  const failed = agents.filter(r => r.status === 'failed').length
  const g = agents.filter(r => r.g > 0).length
  const top = [...agents].sort((a, b) => b.cost - a.cost).slice(0, 3).map(r => `${r.label} ${fmt(r.cost)}`).join(', ')
  const sp = spend(rows, now, tz)
  const budget = settings.budget.monthly ? ` · aylık bütçe ${fmt(sp.month)}/${fmt(settings.budget.monthly)} (tahmin ${fmt(sp.projection)})` : ` · bu ay ${fmt(sp.month)}`
  return {
    event: 'digest',
    title: `☀ Dün: ${fmt(cost)} · ${sessions} session · ${agents.length} agent`,
    body: `${failed ? `${failed} hata · ` : ''}graf-önce %${agents.length ? Math.round((g / agents.length) * 100) : 0}${top ? ` · en pahalı: ${top}` : ''}${budget}`,
    tag: 'sunny',
  }
}
