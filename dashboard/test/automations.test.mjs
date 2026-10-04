import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanSettings, safeTarget, createAutomations, payload, spend, digest } from '../automations.mjs'
import { createServer } from '../server.mjs'

const pub = async () => [{ address: '93.184.216.34' }]
const hook = (trigger, extra = {}) => ({ id: 'k1', name: 'deneme', trigger, action: { url: 'https://hooks.example.com/x', format: 'json' }, ...extra })

function harness(settings, t0 = Date.UTC(2026, 9, 4, 12)) {
  const clock = { t: t0 }
  const sent = []
  const a = createAutomations({ now: () => clock.t, resolve: pub, send: async (url, init) => (sent.push({ url, ...init }), { ok: true, status: 200 }) })
  a.set(settings)
  return { a, clock, sent }
}
const agent = (id, extra = {}) => ({ id, label: id, cls: 'dev', status: 'running', startedAt: 0, steps: [], tokens: { cost: 0.5 }, ...extra })
const view = (runs, extra = {}) => ({ id: 's1', repo: 'o/r', subs: [], runs, totals: { cost: 1 }, sentAt: 0, receivedAt: 0, ...extra })
const wf = (status, agents = [agent('a')]) => ({ taskId: 't1', name: 'feature', status, startedAt: 0, agents })

test('ayarlar: yalnız https, kullanıcı bilgisi yok, bilinmeyen tetikleyici reddedilir', () => {
  assert.throws(() => cleanSettings({ rules: [hook({ type: 'run_end' }, { action: { url: 'http://x.com' } })] }), /https/)
  assert.throws(() => cleanSettings({ rules: [hook({ type: 'run_end' }, { action: { url: 'https://u:p@x.com' } })] }), /kullanıcı/)
  assert.throws(() => cleanSettings({ rules: [hook({ type: 'rm -rf' })] }), /tetikleyici/)
  const s = cleanSettings({ rules: [hook({ type: 'budget', pct: 7, period: 'x', evil: 1 })], budget: { daily: -3, monthly: 100 } })
  assert.deepEqual(s.rules[0].trigger, { type: 'budget', period: 'daily', pct: 80 })
  assert.deepEqual(s.budget, { daily: null, monthly: 100 })
})

test('SSRF: iç ağ, loopback, link-local ve metadata adresleri engellenir', async () => {
  for (const url of ['https://127.0.0.1/x', 'https://10.1.2.3/', 'https://169.254.169.254/', 'https://[::1]/', 'https://192.168.1.1/', 'https://[::ffff:10.0.0.1]/'])
    assert.equal(await safeTarget(url), false, url)
  assert.equal(await safeTarget('https://evil.example/', async () => [{ address: '10.0.0.5' }]), false)
  assert.equal(await safeTarget('https://ok.example/', pub), true)
  assert.equal(await safeTarget('http://ok.example/', pub), false)
})

test('run_end bir kez ateşlenir, filtreye uyar ve biçimler doğru', async () => {
  const { a, sent, clock } = harness({ rules: [hook({ type: 'run_end', status: 'failed' })] })
  await a.onIngest(view([wf('running')]), view([wf('done')]), [])
  assert.equal(sent.length, 0, 'done, failed filtresine takılmalı')
  const { a: b, sent: s2, clock: c2 } = harness({ rules: [hook({ type: 'run_end' })] })
  await b.onIngest(view([wf('running')]), view([wf('done')]), [])
  c2.t += 60e3
  await b.onIngest(view([wf('done')]), view([wf('done')]), [])
  await b.onIngest(view([wf('running')]), view([wf('done')]), []) // aynı olay tekrar gelse de
  assert.equal(s2.length, 1)
  const msg = JSON.parse(s2[0].body)
  assert.equal(msg.event, 'run_end')
  assert.match(msg.title, /feature tamamlandı/)
  assert.equal(s2[0].redirect, 'error')
  void clock
})

test('agent hatası, session maliyeti ve iç ağa gitmeyen teslim günlüğü', async () => {
  const { a, sent } = harness({ rules: [hook({ type: 'agent_failed' }), hook({ type: 'session_cost', usd: 2 }, { id: 'k2' })] })
  await a.onIngest(view([wf('running', [agent('x')])]), view([wf('running', [agent('x', { status: 'failed' })])], { totals: { cost: 3 } }), [])
  assert.equal(sent.length, 2, 'iki ayrı kural, ikisi de ateşlenir')
  const { a: b, sent: s2 } = harness({ rules: [hook({ type: 'session_cost', usd: 2 })] })
  await b.onIngest(view([], { totals: { cost: 1 } }), view([], { totals: { cost: 3 } }), [])
  assert.equal(s2.length, 1)
  const bad = createAutomations({ resolve: async () => [{ address: '127.0.0.1' }], send: async () => assert.fail('gönderilmemeli') })
  const r = await bad.test({ url: 'https://localhost.example/x', format: 'slack' })
  assert.equal(r.ok, false)
  assert.match(r.error, /iç ağ/)
  assert.equal(bad.get().deliveries.length, 1)
})

test('bütçe eşiği günde bir kez, aylık tahmin ve günlük özet', async () => {
  const t0 = Date.UTC(2026, 9, 10, 12)
  const rows = [{ sid: 's', kind: 'sub', label: 'pahalı', start: t0 - 3600e3, cost: 9, status: 'done', g: 1 }, { sid: 's', kind: 'sub', label: 'eski', start: t0 - 5 * 86400e3, cost: 3, status: 'failed', g: 0 }]
  const sp = spend(rows, t0, 0)
  assert.equal(sp.today, 9)
  assert.equal(sp.month, 12)
  assert.ok(sp.projection > 30 && sp.projection < 45, String(sp.projection))
  const { a, sent, clock } = harness({ rules: [hook({ type: 'budget', period: 'daily', pct: 80 })], budget: { daily: 10 } }, t0)
  await a.checkSpend(rows)
  clock.t += 3600e3
  await a.checkSpend(rows)
  assert.equal(sent.length, 1)
  assert.match(JSON.parse(sent[0].body).title, /günlük bütçenin %80/)
  const d = digest(rows, t0 + 86400e3, { tz: 0, budget: { monthly: 50 } })
  assert.match(d.title, /Dün: \$9\.00 · 1 session · 1 agent/)
  assert.match(d.body, /aylık bütçe/)
})

test('ntfy: başlık ASCII, gövde düz metin; slack/discord bağlantı taşır', () => {
  const n = payload('ntfy', { title: 'Şef ✓ bitti', body: 'çok güzel', link: 'https://p/x' })
  assert.equal(n.headers.Click, 'https://p/x')
  assert.equal(n.body, 'Şef ✓ bitti — çok güzel')
  assert.match(JSON.parse(payload('slack', { title: 'a', link: 'https://p' }).body).text, /<https:\/\/p\|Panelde aç>/)
  assert.match(JSON.parse(payload('discord', { title: 'a', link: 'https://p' }).body).content, /https:\/\/p/)
})

test('sessiz agent ve uzun run saatle yakalanır; kurallar diske yazılır', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-auto-'))
  try {
    const clock = { t: 20 * 60e3 }
    const sent = []
    const opts = { dataDir: dir, now: () => clock.t, resolve: pub, send: async (u, i) => (sent.push(i), { ok: true, status: 200 }) }
    const a = createAutomations(opts)
    a.set({ rules: [hook({ type: 'quiet_agent', min: 10 }), hook({ type: 'long_run', min: 15 }, { id: 'k2' })] })
    const v = view([wf('running', [agent('q', { startedAt: 0, steps: [{ t: 5 * 60e3 }] })])], { sentAt: clock.t, receivedAt: clock.t })
    await a.tick([v], [])
    clock.t += 11e3
    await a.tick([v], [])
    assert.equal(sent.length, 2)
    const b = createAutomations(opts) // yeniden başlatma: kurallar ve ateşlenmiş anahtarlar kalır
    assert.equal(b.get().settings.rules.length, 2)
    await b.tick([v], [])
    assert.equal(sent.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('sunucu: otomasyon API oturum, aynı köken ve JSON ister; push run_end tetikler', async t => {
  const pubDir = mkdtempSync(join(tmpdir(), 'wf-pub-'))
  writeFileSync(join(pubDir, 'index.html'), 'x')
  t.after(() => rmSync(pubDir, { recursive: true, force: true }))
  const sent = []
  const TOKEN = 'test-token-0123456789abcdef-0123456', VIEW = 'view-token-0123456789abcdef-012345'
  const server = createServer({ token: TOKEN, viewToken: VIEW, publicDir: pubDir, resolve: pub, fetchImpl: async (u, i) => (sent.push({ u, ...i }), { ok: true, status: 200 }) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${VIEW}` })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const settings = { rules: [hook({ type: 'run_end' })] }
  const post = (headers, body = JSON.stringify(settings), path = '/api/automations') => fetch(base + path, { method: 'POST', headers, body })
  assert.equal((await post({ 'Content-Type': 'application/json' })).status, 401)
  assert.equal((await post({ Cookie: cookie, 'Content-Type': 'text/plain' })).status, 403)
  assert.equal((await post({ Cookie: cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await post({ Cookie: cookie, 'Content-Type': 'application/json' }, '{"rules":[{"trigger":{"type":"run_end"},"action":{"url":"http://x"}}]}')).status, 400)
  assert.equal((await post({ Cookie: cookie, 'Content-Type': 'application/json' })).status, 200)
  const got = await (await fetch(base + '/api/automations', { headers: { Cookie: cookie } })).json()
  assert.equal(got.settings.rules[0].action.url, 'https://hooks.example.com/•••om/x', 'webhook adresi maskeli')
  assert.equal(got.writable, true)
  // maskeli adresle geri kaydetmek gerçek adresi korur
  assert.equal((await post({ Cookie: cookie, 'Content-Type': 'application/json' }, JSON.stringify(got.settings))).status, 200)
  assert.equal(server.auto.get().settings.rules[0].action.url, 'https://hooks.example.com/•••om/x')
  assert.ok('month' in got.spend)
  const push = b => fetch(base + '/api/push', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  const r = status => ({ taskId: 't9', name: 'feature', status, startedAt: 1, endedAt: null, phases: [], agents: [], edges: [] })
  await push({ v: 2, session: { id: 's1', repo: 'o/r' }, sentAt: 1, runs: [r('running')] })
  await push({ v: 2, session: { id: 's1', repo: 'o/r' }, sentAt: 2, runs: [r('done')] })
  for (let i = 0; i < 20 && !sent.length; i++) await new Promise(res => setTimeout(res, 10))
  assert.equal(sent.length, 1)
  assert.match(JSON.parse(sent[0].body).title, /feature tamamlandı/)
})

test('pr_opened: yeni PR bir kez bildirilir, bağlantı PR\'ın kendisi', async () => {
  const { a, sent } = harness({ rules: [hook({ type: 'pr_opened' })] })
  const pr = url => ({ art: { prs: [{ url }] } })
  await a.onIngest(view([], pr('https://github.com/o/r/pull/1')), view([], { art: { prs: [{ url: 'https://github.com/o/r/pull/1' }, { url: 'https://github.com/o/r/pull/2' }] } }), [])
  assert.equal(sent.length, 1)
  const m = JSON.parse(sent[0].body)
  assert.equal(m.link, 'https://github.com/o/r/pull/2')
  assert.match(m.title, /o\/r\/pull\/2/)
})

test('ayrı görüntüleme token\'ı yoksa otomasyonlar salt okunur (push token\'ı webhook ekleyemez)', async t => {
  const pubDir = mkdtempSync(join(tmpdir(), 'wf-pub-'))
  writeFileSync(join(pubDir, 'index.html'), 'x')
  t.after(() => rmSync(pubDir, { recursive: true, force: true }))
  const TOKEN = 'test-token-0123456789abcdef-0123456'
  const server = createServer({ token: TOKEN, publicDir: pubDir })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${TOKEN}` })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const r = await fetch(base + '/api/automations', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: [hook({ type: 'run_end' })] }) })
  assert.equal(r.status, 403)
  assert.equal((await (await fetch(base + '/api/automations', { headers: { Cookie: cookie } })).json()).writable, false)
})

test('Slack/Discord: agent metnindeki toplu etiket ve gizli bağlantı etkisiz', () => {
  const msg = { title: '✕ <!channel> <https://evil|tıkla> hata verdi', body: '@everyone [bak](https://evil)', link: 'https://p/x' }
  const sl = JSON.parse(payload('slack', msg).body).text
  assert.ok(!sl.includes('<!channel>') && !sl.includes('<https://evil'), sl)
  assert.match(sl, /<https:\/\/p\/x\|Panelde aç>$/)
  const dc = JSON.parse(payload('discord', msg).body)
  assert.deepEqual(dc.allowed_mentions, { parse: [] })
  assert.ok(!dc.content.includes('@everyone') && !dc.content.includes('[bak](https'), dc.content)
})

test('SSRF: ayrılmış IPv6 biçimleri ve test gönderimi hız sınırı', async () => {
  for (const url of ['https://[::]/', 'https://[64:ff9b::a00:1]/', 'https://[::a00:1]/', 'https://[fec0::1]/', 'https://198.18.0.1/'])
    assert.equal(await safeTarget(url), false, url)
  const { a } = harness({ rules: [] })
  await a.test({ url: 'https://ok.example/x', format: 'json' })
  await assert.rejects(() => a.test({ url: 'https://ok.example/x', format: 'json' }), /bekle/)
})

test('bozuk zaman damgası sayımı ve saati düşürmez', async () => {
  const { a } = harness({ rules: [hook({ type: 'quiet_agent', min: 1 }), hook({ type: 'daily_cost', usd: 1 }, { id: 'k2' })] })
  const v = view([wf('running', [agent('x', { startedAt: 1e300, steps: [null, { t: 'x' }] })])])
  await a.tick([v], [{ start: 1e300, cost: 5 }, { start: NaN, cost: 1 }])
  assert.ok(spend([{ start: 1e300, cost: 5 }], Date.now(), 0).today === 0)
})
