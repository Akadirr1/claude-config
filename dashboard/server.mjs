// wf-dashboard: wf-monitor mod'unun cloud session'lardan gönderdiği durumu canlı gösterir.
// Bağımlılık yok. Ortam: WF_MONITOR_TOKEN (zorunlu), PORT (varsayılan 3000).
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const TOKEN = process.env.WF_MONITOR_TOKEN
const PORT = Number(process.env.PORT || 3000)
const TTL_MS = 24 * 3600 * 1000
const MAX_BODY = 256 * 1024

if (!TOKEN || TOKEN.length < 16) {
  console.error('WF_MONITOR_TOKEN en az 16 karakter olmalı')
  process.exit(1)
}

const sessions = new Map() // session id -> { id, repo, receivedAt, runs }
const clients = new Set()

function same(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookieToken(req) {
  const m = /(?:^|;\s*)wfk=([^;]+)/.exec(req.headers.cookie || '')
  return m ? decodeURIComponent(m[1]) : ''
}

function viewer(req, url) {
  return same(cookieToken(req), TOKEN) || same(url.searchParams.get('k') || '', TOKEN)
}

function snapshot() {
  const list = [...sessions.values()].sort((a, b) => b.receivedAt - a.receivedAt)
  return JSON.stringify({ serverNow: Date.now(), sessions: list })
}

function broadcast() {
  const data = `data: ${snapshot()}\n\n`
  for (const res of clients) res.write(data)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/push') {
    if (!same(req.headers.authorization || '', `Bearer ${TOKEN}`)) {
      res.writeHead(401).end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req))
      const id = String(body?.session?.id || '')
      if (!id || !Array.isArray(body.runs)) throw new Error('bad shape')
      sessions.set(id, {
        id,
        repo: String(body.session.repo || ''),
        receivedAt: Date.now(),
        runs: body.runs.slice(-10),
      })
      broadcast()
      res.writeHead(204).end()
    } catch {
      res.writeHead(400).end()
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    if (!viewer(req, url)) {
      res.writeHead(401).end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`data: ${snapshot()}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.method === 'GET' && url.pathname === '/') {
    if (!viewer(req, url)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Yetki yok. /?k=<token> ile aç.')
      return
    }
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    if (url.searchParams.has('k')) {
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
      headers['Set-Cookie'] = `wfk=${encodeURIComponent(TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`
    }
    res.writeHead(200, headers).end(PAGE)
    return
  }

  res.writeHead(404).end()
})

// Bağlantıyı tünel/proxy zaman aşımına karşı canlı tut, eski session'ları at
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n')
}, 25000)
setInterval(() => {
  const cutoff = Date.now() - TTL_MS
  let changed = false
  for (const [id, s] of sessions) if (s.receivedAt < cutoff) changed = sessions.delete(id) || changed
  if (changed) broadcast()
}, 60000)

server.listen(PORT, () => console.log(`wf-dashboard :${PORT}`))

const PAGE = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>workflow · canlı</title>
<style>
:root{--bg:#f4f1ea;--card:#fffdf8;--ink:#1d1a16;--dim:#7a7166;--line:#e4ddd0;--run:#c47a12;--ok:#4f7d3a;--bad:#b3401f;--chip:#efe8da;
  color-scheme:light dark;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root{--bg:#151311;--card:#1e1b18;--ink:#ece6dc;--dim:#968b7d;--line:#2e2a25;--run:#e8a33d;--ok:#8fbf6f;--bad:#e4724f;--chip:#2a2621}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px 40px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:18px}
h1{font-size:20px;margin:0;letter-spacing:-.01em}
#conn{font-size:13px;color:var(--dim)}#conn::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bad);margin-right:6px;vertical-align:1px}
#conn.on::before{background:var(--ok)}
.session{margin-bottom:22px}.session h2{font-size:13px;font-weight:600;color:var(--dim);margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em}
.run{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--dim);border-radius:10px;padding:14px 16px;margin-bottom:10px}
.run.running{border-left-color:var(--run)}.run.failed,.run.killed{border-left-color:var(--bad)}.run.done{opacity:.72;border-left-color:var(--ok)}
.top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.name{font-weight:650;font-size:16px}.status{font-size:13px;font-weight:600}.running .status{color:var(--run)}.done .status{color:var(--ok)}.failed .status,.killed .status{color:var(--bad)}
.time{font-variant-numeric:tabular-nums;color:var(--dim);font-size:13px}
.stats{display:flex;gap:18px;margin:8px 0 6px;font-size:14px}.stats b{font-variant-numeric:tabular-nums}
.phases{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.phases span{background:var(--chip);border-radius:999px;padding:2px 10px;font-size:12px}
.last{font-size:13px;color:var(--dim)}
.agents{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px;display:grid;gap:4px}
.agent{display:grid;grid-template-columns:76px 1fr;gap:10px;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-x:auto}
.agent .id{color:var(--dim)}.agent.idle{opacity:.45}
.empty{color:var(--dim);text-align:center;padding:60px 0}
</style>
</head>
<body>
<main>
<header><h1>workflow · canlı</h1><span id="conn">bağlanıyor</span></header>
<div id="root"><p class="empty">Henüz veri yok. Cloud session'da bir workflow başlatınca burada belirir.</p></div>
</main>
<script>
const root = document.getElementById('root'), conn = document.getElementById('conn')
let state = { sessions: [] }, offset = 0
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60)
  return h ? h + 'sa ' + (m % 60) + 'dk' : m ? m + 'dk ' + (s % 60) + 'sn' : s + 'sn' }
const label = st => ({ running: 'çalışıyor', bitti: 'bitti', completed: 'bitti', failed: 'hata', killed: 'durduruldu' }[st] || st)
const cls = st => st === 'running' ? 'running' : st === 'failed' ? 'failed' : st === 'killed' ? 'killed' : 'done'
function render() {
  const now = Date.now() + offset
  if (!state.sessions.length) return
  root.innerHTML = state.sessions.map(s => '<section class="session"><h2>' + esc(s.repo || s.id) + '</h2>' +
    [...s.runs].reverse().map(r => {
      const live = r.status === 'running' ? r.elapsedMs + (now - s.receivedAt) : r.elapsedMs
      const active = r.agents.filter(a => a.active).length
      return '<article class="run ' + cls(r.status) + '"><div class="top"><span class="name">' + esc(r.name) + '</span>' +
        '<span><span class="status">' + esc(label(r.status)) + '</span> · <span class="time">' + dur(live) + '</span></span></div>' +
        '<div class="stats"><span>başlayan <b>' + r.agents.length + '</b></span><span>aktif <b>' + active + '</b></span><span>biten <b>' + r.done + '</b></span></div>' +
        (r.phases.length ? '<div class="phases">' + r.phases.map(p => '<span>' + esc(p) + '</span>').join('') + '</div>' : '') +
        (r.lastLabel ? '<div class="last">son dönen: ' + esc(r.lastLabel) + '</div>' : '') +
        (r.status === 'running' && r.agents.length ? '<div class="agents">' + r.agents.map(a =>
          '<div class="agent' + (a.active ? '' : ' idle') + '"><span class="id">' + esc(a.id) + '</span><span>' + esc(a.last || (a.active ? '…' : 'bekliyor')) + '</span></div>').join('') + '</div>' : '') +
        '</article>'
    }).join('') + '</section>').join('')
}
function connect() {
  const es = new EventSource('/events' + location.search)
  es.onopen = () => { conn.className = 'on'; conn.textContent = 'canlı' }
  es.onmessage = ev => { state = JSON.parse(ev.data); offset = state.serverNow - Date.now(); render() }
  es.onerror = () => { conn.className = ''; conn.textContent = 'bağlantı koptu, tekrar deniyor' }
}
connect(); setInterval(render, 1000)
</script>
</body>
</html>`
