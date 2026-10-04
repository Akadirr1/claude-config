import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.mjs'

const TOKEN = 'test-token-0123456789abcdef-0123456'
let dir

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-public-'))
  for (const f of ['index.html', 'login.html', 'login.js', 'style.css', 'favicon.svg', 'app.js']) writeFileSync(join(dir, f), `/* ${f} */`)
})
after(() => rmSync(dir, { recursive: true, force: true }))

// Her test kendi sunucusunu açar; clock.t ile saat ileri alınabilir.
async function start(t, opts = {}) {
  const clock = { t: Date.now() }
  const server = createServer({ token: TOKEN, publicDir: dir, now: () => clock.t, ...opts })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const req = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init })
  const login = (token, ip = '10.0.0.1') => req('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': ip },
    body: new URLSearchParams({ token }).toString(),
  })
  const cookie = async () => (await login(TOKEN, 'cookie-ip')).headers.get('set-cookie').split(';')[0]
  const push = (body, auth = `Bearer ${TOKEN}`, headers = {}) => req('/api/push', {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { server, clock, base, req, login, cookie, push }
}

// Ham istek: fetch yolu normalize ettiği için traversal testinde gerekli
function raw(base, path) {
  return new Promise((resolve, reject) => {
    http.get(base + '/', { path }, res => { res.resume(); resolve(res.statusCode) }).on('error', reject)
  })
}

// SSE istemcisi: olayları ham metin ve ayrıştırılmış halde sıraya koyar
function sse(base, cookie) {
  const queue = []
  const waiters = []
  let buf = ''
  let req
  const ready = new Promise((resolve, reject) => {
    req = http.get(base + '/events', { headers: cookie ? { Cookie: cookie } : {} }, res => {
      resolve(res)
      res.setEncoding('utf8')
      res.on('data', d => {
        buf += d
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          if (block.startsWith(':')) continue
          const lines = block.split('\n')
          const ev = { raw: block, event: lines.find(l => l.startsWith('event: '))?.slice(7), data: lines.filter(l => l.startsWith('data:')) }
          const w = waiters.shift()
          w ? w(ev) : queue.push(ev)
        }
      })
    })
    req.on('error', reject)
  })
  return {
    ready,
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(r => waiters.push(r))),
    close: () => req.destroy(),
  }
}

const run = (taskId, startedAt, extra = {}) => ({ taskId, name: 'feature', status: 'running', startedAt, endedAt: null, phases: [], agents: [], edges: [], ...extra })
const body = (runs, extra = {}) => ({ v: 2, session: { id: 's1', repo: 'o/r' }, sentAt: 1000, runs, ...extra })
const usage = (model, x) => ({ byModel: { [model]: { in: 0, out: 0, cr: 0, cw: 0, n: 1, ...x } } })
const v3 = (extra = {}) => ({ v: 3, session: { id: 's1', repo: 'o/r' }, sentAt: 1000, epoch: 1, runs: [], subs: [], ...extra })

test('başarılı giriş: 303 / ve güvenli imzalı cookie', async t => {
  const s = await start(t)
  const res = await s.login(TOKEN)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/')
  const c = res.headers.get('set-cookie')
  assert.match(c, /^wf_session=\d+\.[A-Za-z0-9_-]+;/)
  for (const a of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000']) assert.ok(c.includes(a), a)
  assert.ok(!c.includes(TOKEN) && !c.includes(encodeURIComponent(TOKEN)), 'ham token cookie içinde')
  const me = await s.req('/api/me', { headers: { Cookie: c.split(';')[0] } })
  assert.equal(me.status, 204)
  const home = await s.req('/', { headers: { Cookie: c.split(';')[0] } })
  assert.equal(home.status, 200)
  assert.equal(await home.text(), '/* index.html */')
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(home.headers.get('cache-control'), 'no-store')
})

test('başarısız giriş: 303 /login?e=bad, cookie yok', async t => {
  const s = await start(t)
  const res = await s.login('yanlis-token-0123456789')
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login?e=bad')
  assert.equal(res.headers.get('set-cookie'), null)
})

test('login gövdesi 4 KB üstü 413', async t => {
  const s = await start(t)
  const res = await s.req('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + 'a'.repeat(5000) })
  assert.equal(res.status, 413)
})

test('kurcalanmış imza, farklı token ve süresi geçmiş cookie reddedilir', async t => {
  const s = await start(t)
  const c = await s.cookie()
  const me = c => s.req('/api/me', { headers: { Cookie: c } }).then(r => r.status)
  assert.equal(await me(c), 204)
  const sig = c.split('.')[1]
  const bad = c.split('.')[0] + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
  assert.equal(await me(bad), 401)
  const [, issued] = /=(\d+)\./.exec(c)
  assert.equal(await me(c.replace(issued, String(Number(issued) - 1))), 401, 'issuedAt değişince imza tutmamalı')
  assert.equal(await me('wf_session=' + TOKEN), 401)
  assert.equal(await me(''), 401)

  const other = await start(t, { token: 'baska-token-0123456789abcdef-0123456' })
  assert.equal((await other.req('/api/me', { headers: { Cookie: c } })).status, 401)

  s.clock.t += 31 * 24 * 3600 * 1000
  assert.equal(await me(c), 401, 'süresi geçmiş')
  s.clock.t -= 62 * 24 * 3600 * 1000
  assert.equal(await me(c), 401, 'gelecekte')
})

test('?k=TOKEN artık içeri almaz', async t => {
  const s = await start(t)
  const res = await s.req('/?k=' + TOKEN)
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login')
  assert.equal(res.headers.get('set-cookie'), null)
  assert.equal((await s.req('/events?k=' + TOKEN)).status, 401)
  assert.equal((await s.req('/api/me?k=' + TOKEN)).status, 401)
})

test('hız sınırı IP başına; kilitliyken doğru token reddedilir, başka IP etkilenmez', async t => {
  const s = await start(t)
  for (let i = 0; i < 5; i++) assert.equal((await s.login('yanlis-token-0123456789', '1.1.1.1')).headers.get('location'), '/login?e=bad')
  const locked = await s.login(TOKEN, '1.1.1.1')
  assert.equal(locked.status, 303)
  assert.equal(locked.headers.get('location'), '/login?e=rate')
  assert.equal(locked.headers.get('set-cookie'), null)
  assert.ok(Number(locked.headers.get('retry-after')) > 0)
  assert.equal((await s.login(TOKEN, '2.2.2.2')).headers.get('location'), '/')

  s.clock.t += 15 * 60 * 1000 + 1
  assert.equal((await s.login(TOKEN, '1.1.1.1')).headers.get('location'), '/', 'pencere bitince açılır')
})

test('başarılı giriş sayacı sıfırlar', async t => {
  const s = await start(t)
  for (let i = 0; i < 4; i++) await s.login('yanlis-token-0123456789', '3.3.3.3')
  assert.equal((await s.login(TOKEN, '3.3.3.3')).headers.get('location'), '/')
  for (let i = 0; i < 5; i++) assert.equal((await s.login('yanlis-token-0123456789', '3.3.3.3')).headers.get('location'), '/login?e=bad')
})

test('logout cookie siler', async t => {
  const s = await start(t)
  const res = await s.req('/logout', { method: 'POST' })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/login')
  assert.match(res.headers.get('set-cookie'), /^wf_session=;.*Max-Age=0/)
})

test('/api/push yetki ve gövde', async t => {
  const s = await start(t)
  assert.equal((await s.push(body([]), '')).status, 401)
  assert.equal((await s.push(body([]), 'Bearer yanlis')).status, 401)
  assert.equal((await s.push(body([]), TOKEN)).status, 401)
  assert.equal((await s.push(body([run('a', 1)]))).status, 204)
  assert.equal((await s.push('{bozuk')).status, 400)
  assert.equal((await s.push({ v: 2, session: {}, runs: [] })).status, 400)
  assert.equal((await s.push({ v: 2, session: { id: 's' }, runs: {} })).status, 400)
  assert.equal((await s.push({ v: 2, session: { id: 's' }, runs: [{ name: 'x' }] })).status, 400)
  assert.equal((await s.push({ session: { id: 's' }, runs: [] })).status, 400, 'v:2 değil')
  const big = await s.push(body([run('a', 1, { pad: 'x'.repeat(300 * 1024) })]))
  assert.ok([413, 400].includes(big.status), String(big.status))
})

test('oturumsuz erişim ve açık dosyalar', async t => {
  const s = await start(t)
  const home = await s.req('/')
  assert.equal(home.status, 303)
  assert.equal(home.headers.get('location'), '/login')
  assert.ok([401, 303].includes((await s.req('/app.js')).status))
  assert.equal((await s.req('/events')).status, 401)
  const login = await s.req('/login')
  assert.equal(login.status, 200)
  assert.match(login.headers.get('content-type'), /text\/html/)
  assert.equal(await login.text(), '/* login.html */')
  assert.ok(login.headers.get('content-security-policy'))
  for (const p of ['/login.js', '/style.css', '/favicon.svg']) assert.equal((await s.req(p)).status, 200, p)
  assert.match((await s.req('/style.css')).headers.get('content-type'), /text\/css/)
  assert.equal((await s.req('/healthz')).status, 200)
  assert.equal((await s.req('/yok.js')).status, 404)
})

test('path traversal 404', async t => {
  const s = await start(t)
  const c = await s.cookie()
  for (const p of ['/../server.mjs', '/%2e%2e/server.mjs', '/%2e%2e%2fserver.mjs', '/..%2fserver.mjs', '//etc/passwd', '/test/server.test.mjs']) {
    assert.equal(await raw(s.base, p), 404, p)
  }
  assert.equal((await s.req('/%2e%2e/server.mjs', { headers: { Cookie: c } })).status, 404)
})

test('SSE: snapshot (index + canlı görünüm), session olayı yalnız değişenleri taşır, eski run kalır', async t => {
  const s = await start(t)
  const c = await s.cookie()
  await s.push(body([run('a', 1), run('b', 2)]))
  const es = sse(s.base, c)
  t.after(es.close)
  const res = await es.ready
  assert.match(res.headers['content-type'], /text\/event-stream/)
  const snap = await es.next()
  assert.equal(snap.event, 'snapshot')
  const sd = JSON.parse(snap.data[0].slice(6))
  assert.equal(sd.index.length, 1)
  assert.equal(sd.index[0].id, 's1')
  assert.deepEqual(sd.live[0].runs.map(r => r.taskId), ['a', 'b'])
  assert.equal(sd.live[0].sentAt, 1000)
  assert.equal(typeof sd.serverNow, 'number')

  await s.push(body([run('b', 2, { status: 'done' }), run('c', 3)], { sentAt: 'x' }))
  const ev = await es.next()
  assert.equal(ev.event, 'session')
  const { summary, patch } = JSON.parse(ev.data[0].slice(6))
  assert.deepEqual(patch.runs.map(r => r.taskId), ['b', 'c'], 'yama yalnız push edilenleri taşır')
  assert.equal(patch.runs[0].status, 'done')
  assert.deepEqual(summary.runs.map(r => r.taskId), ['a', 'b', 'c'], 'eski run kalır')
  assert.equal(patch.sentAt, patch.receivedAt, 'sayı olmayan sentAt → receivedAt')

  await s.push(body([run('x', 1)], { session: { id: 's2', repo: 'o/r2' } }))
  assert.equal(JSON.parse((await es.next()).data[0].slice(6)).summary.id, 's2', 'yalnız o session gönderilir')
})

test('SSE: data satırına enjeksiyon yapılamaz', async t => {
  const s = await start(t)
  const es = sse(s.base, await s.cookie())
  t.after(es.close)
  await es.next()
  const label = 'x\n\ndata: x\r\nevent: remove\n<script>alert(1)</script> '
  await s.push(body([run('a', 1, { agents: [{ id: 'a1', label }] })]))
  const ev = await es.next()
  assert.equal(ev.event, 'session')
  assert.equal(ev.data.length, 1)
  assert.equal(ev.raw.split('\n').length, 2, 'event + tek data satırı')
  assert.equal(JSON.parse(ev.data[0].slice(6)).patch.runs[0].agents[0].label, label)
})

const data = ev => JSON.parse(ev.data[0].slice(6))

test('push: yanlış Bearer IP başına sayılır, kilitliyken 429; login ayrı sayılır', async t => {
  const s = await start(t)
  const ip = { 'CF-Connecting-IP': '4.4.4.4' }
  for (let i = 0; i < 5; i++) assert.equal((await s.push(body([]), 'Bearer yanlis', ip)).status, 401)
  const locked = await s.push(body([]), undefined, ip)
  assert.equal(locked.status, 429)
  assert.ok(Number(locked.headers.get('retry-after')) > 0)
  assert.equal((await s.login(TOKEN, '4.4.4.4')).headers.get('location'), '/', 'push hatası login\'i kilitlemez')
  for (let i = 0; i < 5; i++) await s.login('yanlis-token-0123456789', '5.5.5.5')
  assert.equal((await s.login(TOKEN, '5.5.5.5')).headers.get('location'), '/login?e=rate', 'login kilitli')
  assert.equal((await s.push(body([]), undefined, { 'CF-Connecting-IP': '5.5.5.5' })).status, 204, 'login hatası push\'u kilitlemez')
  s.clock.t += 15 * 60 * 1000 + 1
  assert.equal((await s.push(body([]), undefined, ip)).status, 204, 'pencere bitince açılır')
})

test('viewToken: giriş viewToken ile, push token ile', async t => {
  const VIEW = 'view-token-0123456789abcdef-0123456'
  const s = await start(t, { viewToken: VIEW })
  assert.equal((await s.login(TOKEN)).headers.get('location'), '/login?e=bad', 'push token girişte geçmez')
  const ok = await s.login(VIEW)
  assert.equal(ok.headers.get('location'), '/')
  assert.equal((await s.req('/api/me', { headers: { Cookie: ok.headers.get('set-cookie').split(';')[0] } })).status, 204)
  assert.equal((await s.push(body([]))).status, 204, 'push token Bearer\'da çalışır')
  assert.equal((await s.push(body([]), `Bearer ${VIEW}`)).status, 401, 'view token push\'ta geçmez')
})

test('token uzunluğu: <16 hata, <32 uyarı', t => {
  const warn = t.mock.method(console, 'warn', () => {})
  assert.throws(() => createServer({ token: 'kisa', publicDir: dir }), /WF_MONITOR_TOKEN/)
  assert.throws(() => createServer({ token: TOKEN, viewToken: 'kisa', publicDir: dir }), /WF_VIEW_TOKEN/)
  createServer({ token: TOKEN, publicDir: dir })
  assert.equal(warn.mock.callCount(), 0)
  createServer({ token: '0123456789abcdef', viewToken: '0123456789abcdefg', publicDir: dir })
  assert.equal(warn.mock.callCount(), 2)
})

test('push: stringify edilemeyen (derin iç içe) gövde 400 ve kaydedilmez', async t => {
  const s = await start(t)
  const n = 120000
  const res = await s.push('{"v":2,"session":{"id":"d"},"runs":[{"taskId":"a","x":' + '['.repeat(n) + ']'.repeat(n) + '}]}')
  assert.equal(res.status, 400)
  const es = sse(s.base, await s.cookie())
  t.after(es.close)
  assert.equal(data(await es.next()).index.length, 0)
})

test('push: bayat sentAt (aynı epoch) 204 ama yok sayılır; yeni epoch kabul', async t => {
  const s = await start(t)
  const es = sse(s.base, await s.cookie())
  t.after(es.close)
  await es.next()
  await s.push(body([run('a', 1)], { sentAt: 2000 }))
  assert.equal(data(await es.next()).patch.sentAt, 2000)
  assert.equal((await s.push(body([run('eski', 2)], { sentAt: 1500 }))).status, 204)
  await s.push(body([run('b', 3)], { sentAt: 2000 }))
  assert.deepEqual(data(await es.next()).summary.runs.map(r => r.taskId), ['a', 'b'], 'bayat push kaydedilmedi')
  // mod yeniden başladı: yeni epoch, saat geride olsa da kabul
  await s.push({ ...v3(), epoch: 2, sentAt: 100, runs: [run('c', 4)] })
  assert.deepEqual(data(await es.next()).summary.runs.map(r => r.taskId), ['a', 'b', 'c'])
})

test('CSRF: login/logout çapraz site 403, push etkilenmez', async t => {
  const s = await start(t)
  const host = new URL(s.base).host
  const post = (path, headers) => s.req(path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ token: TOKEN }).toString(),
  })
  for (const path of ['/login', '/logout']) {
    assert.equal((await post(path, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, path)
    assert.equal((await post(path, { 'Sec-Fetch-Site': 'same-site' })).status, 403, path)
    assert.equal((await post(path, { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://kotu.example' })).status, 303, path)
    assert.equal((await post(path, { Origin: 'https://kotu.example' })).status, 403, path)
    assert.equal((await post(path, { Origin: 'null' })).status, 403, path)
    assert.equal((await post(path, { Origin: `http://${host}` })).status, 303, path)
    assert.equal((await post(path, {})).status, 303, path + ' başlıksız (curl)')
  }
  assert.equal((await s.push(body([]), undefined, { Origin: 'https://kotu.example', 'Sec-Fetch-Site': 'cross-site' })).status, 204)
})

test('login ve logout eski wfk cookie\'sini siler', async t => {
  const s = await start(t)
  for (const res of [await s.login(TOKEN), await s.req('/logout', { method: 'POST' })]) {
    assert.ok(res.headers.getSetCookie().includes('wfk=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict'))
  }
  assert.ok(!(await s.login('yanlis-token-0123456789')).headers.getSetCookie().length)
})

test('SSE: okumayan istemci tampon 1 MB\'ı aşınca koparılır', async t => {
  const s = await start(t)
  const c = await s.cookie()
  const res = await new Promise((resolve, reject) => http.get(s.base + '/events', { headers: { Cookie: c } }, resolve).on('error', reject))
  res.pause()
  t.after(() => res.destroy())
  const closed = new Promise(r => res.on('close', r))
  const big = 'x'.repeat(200 * 1024)
  for (let i = 0; i < 100; i++) await s.push(body([run('a', 1, { big })]))
  res.resume()
  await closed
  // Kopan istemci kümeden çıktı: sonraki yayın hata vermez
  assert.equal((await s.push(body([run('b', 2)]))).status, 204)
})

test('v3: orkestratör epoch başına toplanır, alt agent ve workflow agent sınıf + maliyet alır', async t => {
  const s = await start(t)
  const c = await s.cookie()
  const main = u => ({ status: 'tool', goal: 'panel token analizi', steps: [], usage: usage('claude-opus-5-5', u) })
  await s.push(v3({ main: main({ in: 1000, out: 500 }) }))
  await s.push(v3({ sentAt: 2000, main: main({ in: 2000, out: 1000 }) })) // aynı epoch: kümülatif, yerine geçer
  await s.push(v3({ epoch: 2, sentAt: 3000, main: main({ in: 1e6 }), // yeni süreç: eklenir
    subs: [{ id: 'sub1', label: 'Map server routes', agentType: 'Explore', status: 'done', startedAt: 10, endedAt: 20, usage: usage('claude-sonnet-5-5', { in: 1e6, out: 1e5 }), graph: { g: 3, r: 1 } }],
    runs: [run('w1', 5, { agents: [{ id: 'ag1', label: 'security-review #1', phase: 'Review', usage: usage('claude-haiku-4-5', { cr: 1e6 }) }] })],
  }))
  const v = (await (await s.req('/api/sessions/s1', { headers: { Cookie: c } })).json()).view
  assert.equal(v.main.cls, 'orchestrator')
  assert.equal(v.main.tokens.in, 2000 + 1e6)
  assert.equal(v.main.goal, 'panel token analizi')
  assert.equal(v.subs[0].cls, 'explore')
  assert.ok(Math.abs(v.subs[0].tokens.cost - (2 + 1)) < 1e-9, 'sonnet 5.5: 1M giriş $2 + 100k çıkış $1')
  assert.equal(v.runs[0].agents[0].cls, 'review')
  assert.ok(Math.abs(v.runs[0].agents[0].tokens.cost - 0.1) < 1e-9, 'haiku cache okuma $0.10/M')
  assert.equal(v.totals.agents, 2)
  assert.equal(v.totals.graph.g, 3)
  assert.ok(v.totals.byClass.explore.cost > 0 && v.totals.byClass.orchestrator.cost > 0)
})

test('v3: geçersiz gövdeler 400', async t => {
  const s = await start(t)
  for (const b of [v3({ subs: [{}] }), v3({ subs: 'x' }), v3({ main: [] }), { ...v3(), v: 4 }, v3({ session: { id: '' } })]) {
    assert.equal((await s.push(b)).status, 400, JSON.stringify(b).slice(0, 60))
  }
})

test('kalıcılık: sunucu yeniden başlayınca defter diskten yüklenir', async t => {
  const data = mkdtempSync(join(tmpdir(), 'wf-data-'))
  t.after(() => rmSync(data, { recursive: true, force: true }))
  const a = await start(t, { dataDir: data })
  await a.push(v3({ subs: [{ id: 'x1', label: 'qa #1', status: 'done', usage: usage('claude-opus-5-5', { out: 1e6 }) }] }))
  a.server.store.flush()
  const b = await start(t, { dataDir: data })
  const c = await b.cookie()
  const idx = (await (await b.req('/api/sessions', { headers: { Cookie: c } })).json()).index
  assert.equal(idx.length, 1)
  assert.equal(idx[0].totals.cost, 20)
  const v = (await (await b.req('/api/sessions/s1', { headers: { Cookie: c } })).json()).view
  assert.equal(v.subs[0].cls, 'qa')
})

test('analiz ve CSV: sınıf/model/gün kırılımı, graphify karşılaştırması, CSV enjeksiyonu önlenir', async t => {
  const s = await start(t)
  const c = await s.cookie()
  const now = s.clock.t
  await s.push(v3({ subs: [
    { id: 'g1', label: 'dev #1', startedAt: now - 1000, endedAt: now, usage: usage('claude-opus-5-5', { in: 100 }), graph: { g: 2, r: 1 } },
    { id: 'g2', label: '=HYPERLINK("x")', startedAt: now - 1000, endedAt: now, usage: usage('claude-opus-5-5', { in: 900 }), graph: { g: 0, r: 9 } },
  ] }))
  const st = await (await s.req('/api/stats?days=7&tz=180', { headers: { Cookie: c } })).json()
  assert.equal(st.totals.agents, 2)
  assert.equal(st.byDay.length, 7)
  assert.equal(st.graphify.with.n, 1)
  assert.equal(st.graphify.with.avgIn, 100)
  assert.equal(st.graphify.without.avgIn, 900)
  assert.deepEqual(st.repos, ['o/r'])
  assert.ok(st.byClass.find(x => x.key === 'dev'))
  const csv = await (await s.req('/api/export.csv?days=0', { headers: { Cookie: c } })).text()
  assert.match(csv.split('\n')[0], /^sid,repo,kind/)
  assert.match(csv, /'=HYPERLINK/, 'formül hücresi kaçışlanır')
})

test('/api/* oturum ister; bilinmeyen session 404', async t => {
  const s = await start(t)
  for (const p of ['/api/sessions', '/api/sessions/s1', '/api/stats', '/api/export.csv']) assert.equal((await s.req(p)).status, 401, p)
  const c = await s.cookie()
  assert.equal((await s.req('/api/sessions/yok', { headers: { Cookie: c } })).status, 404)
  assert.equal((await s.req('/api/sessions/%E0%A4%A', { headers: { Cookie: c } })).status, 400)
})
