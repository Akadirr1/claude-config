// wf-dashboard: wf-monitor mod'unun cloud session'lardan gönderdiği durumu canlı gösterir.
// Bağımlılık yok. Ortam: WF_MONITOR_TOKEN (zorunlu, ≥16; /api/push), WF_VIEW_TOKEN (opsiyonel, ≥16; giriş formu,
// yoksa WF_MONITOR_TOKEN), PORT (3000), WF_PUBLIC_DIR (./public).
import http from 'node:http'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TTL_MS = 24 * 3600 * 1000
const MAX_PUSH = 256 * 1024
const MAX_LOGIN = 4 * 1024
const MAX_RUNS = 20
const SESSION_MS = 30 * 24 * 3600 * 1000
const RATE_WINDOW = 15 * 60 * 1000
const RATE_MAX = 5
const RATE_TABLE_MAX = 10000
const MAX_SESSIONS = 50
const MAX_BUFFERED = 1024 * 1024
const CLEAR_OLD = 'wfk=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const OPEN = new Set(['/login.html', '/login.js', '/style.css', '/favicon.svg'])
const SEC = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

function same(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

// Gövdeyi max'a kadar biriktirir, fazlasını atar (bağlantıyı koparmadan 413 dönebilmek için); fazlaysa null.
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size <= max) chunks.push(c)
    })
    req.on('end', () => resolve(size > max ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Başlangıçta public/ düz dosyalarını belleğe alır; yalnız bunlar servis edilir (traversal yok).
function loadStatic(dir) {
  const files = new Map()
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name.startsWith('.') || !statSync(p).isFile()) continue
    files.set('/' + name, { body: readFileSync(p), type: TYPES[extname(name)] || 'application/octet-stream' })
  }
  return files
}

const ipOf = req => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '')

// Tarayıcıdan gelen çapraz site POST'u: Sec-Fetch-Site, yoksa Origin/Host. İkisi de yoksa (curl) izin.
function crossSite(req) {
  const site = req.headers['sec-fetch-site']
  if (site) return site !== 'same-origin'
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== req.headers.host
  } catch {
    return true
  }
}

export function createServer({ token, viewToken, publicDir = fileURLToPath(new URL('./public/', import.meta.url)), now = Date.now }) {
  for (const [name, v] of [['WF_MONITOR_TOKEN', token], ['WF_VIEW_TOKEN', viewToken]]) {
    if (name === 'WF_VIEW_TOKEN' && v === undefined) continue
    if (!v || v.length < 16) throw new Error(`${name} en az 16 karakter olmalı`)
    if (v.length < 32) console.warn(`uyarı: ${name} 32 karakterden kısa`)
  }
  const view = viewToken ?? token
  const files = loadStatic(publicDir)
  const key = createHmac('sha256', view).update('wf-session-key').digest()
  const sessions = new Map() // id -> { s: Session, json: JSON.stringify(s), sent: body.sentAt | undefined }
  const clients = new Set()
  const failures = new Map() // ip -> { count, resetAt }

  const sign = issuedAt => createHmac('sha256', key).update('wf-session:' + issuedAt).digest('base64url')

  function authed(req) {
    const m = /(?:^|;\s*)wf_session=(\d{1,15})\.([A-Za-z0-9_-]{1,64})(?:;|$)/.exec(req.headers.cookie || '')
    if (!m) return false
    const issuedAt = Number(m[1])
    const t = now()
    return issuedAt <= t && t - issuedAt < SESSION_MS && same(m[2], sign(issuedAt))
  }

  // Okumayan istemcinin tamponu MAX_BUFFERED'ı aşarsa bağlantıyı kopar (bellek şişmesin).
  function write(res, chunk) {
    if (res.writableLength <= MAX_BUFFERED) res.write(chunk)
    if (res.writableLength > MAX_BUFFERED) {
      clients.delete(res)
      res.destroy()
    }
  }
  // data: JSON metni; JSON.stringify \n ve \r'yi kaçışlar, tek data satırı garanti.
  const send = (res, event, data) => write(res, `event: ${event}\ndata: ${data}\n\n`)
  const broadcast = (event, data) => { for (const res of clients) send(res, event, data) }
  const remove = (id, t) => {
    sessions.delete(id)
    broadcast('remove', JSON.stringify({ serverNow: t, id }))
  }

  function sweep() {
    const t = now()
    for (const [id, e] of sessions) if (e.s.receivedAt < t - TTL_MS) remove(id, t)
    for (const [ip, f] of failures) if (f.resetAt <= t) failures.delete(ip)
  }

  function redirect(res, location, extra = {}) {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...extra }).end()
  }

  // Hız sınırı (login ve push ortak): kilitliyse kalan saniye, değilse 0.
  function lockedFor(ip, t) {
    const f = failures.get(ip)
    if (f && f.resetAt <= t) failures.delete(ip)
    else if (f && f.count >= RATE_MAX) return Math.ceil((f.resetAt - t) / 1000)
    return 0
  }
  function fail(ip, t) {
    let f = failures.get(ip)
    if (!f) {
      if (failures.size >= RATE_TABLE_MAX) sweep()
      // ponytail: tablo doluysa en eski girdiyi at; çok sayıda sahte IP ile sayaç silinebilir, token ≥16 kr olduğundan kabul.
      if (failures.size >= RATE_TABLE_MAX) failures.delete(failures.keys().next().value)
      f = { count: 0, resetAt: t + RATE_WINDOW }
      failures.set(ip, f)
    }
    f.count++
  }

  async function login(req, res) {
    const ip = ipOf(req)
    const body = await readBody(req, MAX_LOGIN)
    if (body === null) return res.writeHead(413).end()
    const t = now()
    const wait = lockedFor(ip, t)
    if (wait) return redirect(res, '/login?e=rate', { 'Retry-After': String(wait) })
    if (same(new URLSearchParams(body).get('token') || '', view)) {
      failures.delete(ip)
      const issuedAt = t
      return redirect(res, '/', {
        'Set-Cookie': [`wf_session=${issuedAt}.${sign(issuedAt)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`, CLEAR_OLD],
      })
    }
    fail(ip, t)
    redirect(res, '/login?e=bad')
  }

  async function push(req, res) {
    const ip = ipOf(req)
    const t = now()
    const wait = lockedFor(ip, t)
    if (wait) return res.writeHead(429, { 'Retry-After': String(wait) }).end()
    if (!same(req.headers.authorization || '', `Bearer ${token}`)) {
      fail(ip, t)
      return res.writeHead(401).end()
    }
    const raw = await readBody(req, MAX_PUSH)
    if (raw === null) return res.writeHead(413).end()
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return res.writeHead(400).end()
    }
    const id = body?.session?.id
    const runs = body?.runs
    if (body?.v !== 2 || typeof id !== 'string' || !id || !Array.isArray(runs) ||
        !runs.every(r => r && typeof r === 'object' && typeof r.taskId === 'string' && r.taskId)) {
      return res.writeHead(400).end()
    }
    const prev = sessions.get(id)
    const sent = Number.isFinite(body.sentAt) ? body.sentAt : undefined
    // Bayat (sırası karışmış) push: kabul et ama yok say.
    if (sent !== undefined && prev?.sent !== undefined && sent < prev.sent) return res.writeHead(204).end()
    const receivedAt = now()
    const merged = new Map((prev?.s.runs || []).map(r => [r.taskId, r]))
    for (const r of runs) merged.set(r.taskId, r)
    const start = r => (Number.isFinite(r.startedAt) ? r.startedAt : 0)
    const session = {
      id,
      repo: String(body.session.repo ?? ''),
      receivedAt,
      sentAt: sent ?? receivedAt,
      runs: [...merged.values()].sort((a, b) => start(a) - start(b)).slice(-MAX_RUNS),
    }
    let json
    try {
      json = JSON.stringify(session)
    } catch {
      return res.writeHead(400).end() // derin iç içe vb. (RangeError)
    }
    sessions.set(id, { s: session, json, sent })
    if (sessions.size > MAX_SESSIONS) {
      let oldest
      for (const [k, e] of sessions) if (!oldest || e.s.receivedAt < sessions.get(oldest).s.receivedAt) oldest = k
      remove(oldest, receivedAt)
    }
    broadcast('session', `{"serverNow":${receivedAt},"session":${json}}`)
    res.writeHead(204).end()
  }

  function events(req, res) {
    if (!authed(req)) return res.writeHead(401).end()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const list = [...sessions.values()].sort((a, b) => b.s.receivedAt - a.s.receivedAt).map(e => e.json)
    clients.add(res)
    send(res, 'snapshot', `{"serverNow":${now()},"sessions":[${list.join(',')}]}`)
    req.on('close', () => clients.delete(res))
  }

  const server = http.createServer(async (req, res) => {
    try {
      // 'http://x' + req.url: '//host' gibi yollar başka host'a çözülmesin
      const path = new URL('http://x' + req.url).pathname
      const route = `${req.method} ${path}`
      if (route === 'GET /healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
      if (route === 'POST /api/push') return await push(req, res)
      if ((route === 'POST /login' || route === 'POST /logout') && crossSite(req)) return res.writeHead(403).end()
      if (route === 'POST /login') return await login(req, res)
      if (route === 'POST /logout') {
        return redirect(res, '/login', { 'Set-Cookie': ['wf_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0', CLEAR_OLD] })
      }
      if (route === 'GET /api/me') return res.writeHead(authed(req) ? 204 : 401, { 'Cache-Control': 'no-store' }).end()
      if (route === 'GET /events') return events(req, res)
      if (req.method === 'GET') {
        const name = path === '/' ? '/index.html' : path === '/login' ? '/login.html' : path
        const file = files.get(name)
        if (file) {
          if (!OPEN.has(name) && !authed(req)) {
            return name === '/index.html' ? redirect(res, '/login') : res.writeHead(401).end()
          }
          return res.writeHead(200, { 'Content-Type': file.type, ...SEC }).end(file.body)
        }
      }
      res.writeHead(404).end()
    } catch {
      if (!res.headersSent) res.writeHead(400)
      res.end()
    }
  })

  // Bağlantıyı tünel/proxy zaman aşımına karşı canlı tut; eski session'ları ve hız sınırı kayıtlarını at
  const timers = [
    setInterval(() => { for (const res of clients) write(res, ': ping\n\n') }, 25000),
    setInterval(sweep, 60000),
  ]
  for (const t of timers) t.unref()
  server.on('close', () => timers.forEach(clearInterval))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let server
  try {
    server = createServer({
      token: process.env.WF_MONITOR_TOKEN,
      viewToken: process.env.WF_VIEW_TOKEN || undefined,
      publicDir: process.env.WF_PUBLIC_DIR || undefined,
    })
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  const port = Number(process.env.PORT || 3000)
  server.listen(port, () => console.log(`wf-dashboard :${port}`))
}
