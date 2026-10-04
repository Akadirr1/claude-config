#!/usr/bin/env node
// Panel için sahte agentic session'lar: gerçek run başlatmadan sözleşmedeki v3 push'larını adım adım
// POST /api/push'a yollar (mod gibi: orkestratör her seferinde, alt agent ve run'lar değiştikçe).
// Kullanım: WF_MONITOR_TOKEN=... node dashboard/dev/simulate.mjs [http://localhost:3000] [--fast] [--history 30]
//   --fast      bekleme süresini kısaltır
//   --history N son N güne yayılmış geçmiş session'lar da yazar (Maliyet ekranı dolsun)
// Cookie her zaman Secure: düz http://localhost ile Chrome/Firefox çalışır, Safari çalışmaz.
import { randomBytes } from 'node:crypto'

const argv = process.argv.slice(2)
const BASE = (argv.find(a => /^https?:/.test(a)) ?? 'http://localhost:3000').replace(/\/+$/, '')
const FAST = argv.includes('--fast')
const HISTORY = Number(argv[argv.indexOf('--history') + 1]) || (argv.includes('--history') ? 30 : 0)
const TOKEN = process.env.WF_MONITOR_TOKEN
if (!TOKEN) {
  console.error('WF_MONITOR_TOKEN gerekli')
  process.exit(1)
}

const hex = n => randomBytes(n).toString('hex')
const sleep = ms => new Promise(r => setTimeout(r, FAST ? Math.min(ms, 60) : ms))
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = xs => xs[Math.floor(rnd() * xs.length)]
const between = (a, b) => Math.round(a + rnd() * (b - a))
const PHASES = ['Analiz', 'Geliştirme', 'Review', 'QA']
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-4-5'

async function post(body) {
  const res = await fetch(`${BASE}/api/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status !== 204) throw new Error(`push ${res.status}`)
}

// Bir agentic session: mod'un tuttuğu durumun küçük bir taklidi
class Session {
  constructor(repo, start = Date.now()) {
    this.id = `session_${hex(12)}`
    this.repo = repo
    this.clock = start
    this.epoch = start
    this.main = { startedAt: start, status: 'idle', since: start, tool: null, goal: '', turns: 0, answer: '', model: OPUS, steps: [], usage: { byModel: {} }, tools: {}, graph: { g: 0, r: 0 } }
    this.subs = new Map()
    this.runs = new Map()
    this.dirty = new Set()
    this.art = { files: new Map(), commits: [], prs: [] }
  }
  tick(sec) {
    this.clock += sec * 1000
  }
  spend(target, model, scale = 1) {
    const by = (target.usage ??= { byModel: {} }).byModel
    const x = (by[model] ??= { in: 0, out: 0, cr: 0, cw: 0, n: 0 })
    x.in += Math.round(between(1500, 9000) * scale)
    x.out += Math.round(between(300, 2400) * scale)
    x.cr += Math.round(between(8000, 60000) * scale)
    x.cw += Math.round(between(500, 6000) * scale)
    x.n++
  }
  step(target, tool, arg, key) {
    const text = `${tool}: ${arg}`.slice(0, 160)
    target.steps.push(target === this.main ? { t: this.clock, text, tool } : { t: this.clock, text })
    target.steps = target.steps.slice(target === this.main ? -40 : -10)
    target.tools[tool] = (target.tools[tool] ?? 0) + 1
    if (/graphify/.test(arg)) target.graph.g++
    else if (['Read', 'Grep', 'Glob'].includes(tool)) target.graph.r++
    if (key) this.dirty.add(key)
    const by = target === this.main ? 'main' : target.id
    if (tool === 'Edit' || tool === 'Write') {
      const p = '/home/user/' + this.repo.split('/')[1] + '/' + arg
      const f = this.art.files.get(p) ?? { p, n: 0, t: this.clock, by: [] }
      f.n++
      f.t = this.clock
      if (!f.by.includes(by)) f.by.push(by)
      this.art.files.set(p, f)
    }
    const m = /git commit -m "(.+)"/.exec(arg)
    if (tool === 'Bash' && m) this.art.commits.push({ sha: hex(7), branch: 'claude/sim', msg: m[1], t: this.clock, by })
  }
  pr(n, by = 'main') {
    this.art.prs.push({ url: `https://github.com/${this.repo}/pull/${n}`, t: this.clock, by })
  }
  turn(goal) {
    this.main.turns++
    this.main.goal = goal
    this.main.status = 'thinking'
    this.main.since = this.clock
  }
  think() {
    this.main.status = 'thinking'
    this.main.tool = null
    this.spend(this.main, OPUS, 0.6)
  }
  tool(name, arg) {
    this.main.status = 'tool'
    this.main.tool = name
    this.main.since = this.clock
    this.step(this.main, name, arg)
  }
  idle(answer) {
    this.main.status = 'idle'
    this.main.tool = null
    this.main.answer = answer
    this.main.since = this.clock
  }
  spawn(label, agentType, model, hint, parent = 'main') {
    const id = 'a' + hex(8)
    const s = { id, label, agentType, model, hint, parent, status: 'running', startedAt: this.clock, endedAt: null, steps: [], result: null, usage: { byModel: {} }, tools: {}, graph: { g: 0, r: 0 } }
    this.subs.set(id, s)
    this.dirty.add('s:' + id)
    this.tool('Agent', `${agentType}: ${label}`)
    return s
  }
  workSub(s, tool, arg, scale = 1) {
    this.step(s, tool, arg, 's:' + s.id)
    this.spend(s, s.model, scale)
  }
  endSub(s, status, text) {
    s.status = status
    s.endedAt = this.clock
    s.result = text ? { kind: 'text', text } : null
    this.dirty.add('s:' + s.id)
  }
  async push() {
    const subs = [...this.subs.values()].filter(s => this.dirty.has('s:' + s.id))
    const runs = [...this.runs.values()].filter(r => this.dirty.has('r:' + r.data.taskId)).map(r => r.view())
    this.dirty.clear()
    await post({ v: 3, session: { id: this.id, repo: this.repo }, epoch: this.epoch, sentAt: this.clock, main: this.main, misc: { usage: { byModel: {} } }, subs, runs, art: { ...this.art, files: [...this.art.files.values()] } })
  }
}

// Sözleşmedeki dalga/kenar kuralıyla bir workflow run'ı
class Run {
  constructor(session, name = 'feature') {
    this.s = session
    this.data = { taskId: 'w' + hex(6), name, parent: 'main', status: 'running', startedAt: session.clock, endedAt: null, phases: PHASES }
    this.agents = []
    this.wave = -1
    session.runs.set(this.data.taskId, this)
    session.tool('Workflow', name)
    this.touch()
  }
  touch() {
    this.s.dirty.add('r:' + this.data.taskId)
  }
  start(labels) {
    this.wave++
    const out = labels.map(([label, phase, agentType = null, model = SONNET]) => {
      const a = { id: 'w' + hex(8), label, phase, round: Number(/#(\d+)/.exec(label)?.[1] ?? 1), agentType, model, status: 'running', startedAt: this.s.clock, endedAt: null, wave: this.wave, steps: [], result: null, usage: { byModel: {} }, tools: {}, graph: { g: 0, r: 0 } }
      this.agents.push(a)
      return a
    })
    this.touch()
    return out
  }
  work(a, tool, arg, scale = 1) {
    this.s.step(a, tool, arg)
    this.s.spend(a, a.model, scale)
    this.touch()
  }
  end(a, status, result) {
    a.status = status
    a.endedAt = this.s.clock
    a.result = result ?? null
    this.touch()
  }
  finish(status) {
    this.data.status = status
    this.data.endedAt = this.s.clock
    for (const a of this.agents) if (a.status === 'running') this.end(a, status === 'failed' ? 'failed' : 'stopped')
    this.touch()
  }
  edges() {
    const out = []
    for (const to of this.agents)
      for (const from of this.agents) {
        if (from.wave !== to.wave - 1) continue
        const loop = to.round > from.round || PHASES.indexOf(to.phase) < PHASES.indexOf(from.phase)
        out.push({ from: from.id, to: to.id, kind: loop ? 'loop' : 'handoff' })
      }
    return out
  }
  view() {
    return { ...this.data, agents: this.agents.map(a => ({ ...a })), edges: this.edges() }
  }
}

const SPEC = { kind: 'spec', criteria: ['Her agent için token ve maliyet görünür', 'Geçmiş kalıcı saklanır', 'Orkestratör panelde görünür'], files: ['dashboard/server.mjs', 'dashboard/store.mjs', 'mods/wf-monitor/hooks/register.js'], outOfScope: ['fatura entegrasyonu'], risks: ['fiyatlar liste fiyatı, abonelik farklı'] }
const FIND = { kind: 'review', findings: [
  { severity: 'Important', where: 'dashboard/store.mjs:88', issue: 'CSV hücresi formül olarak yorumlanabilir: =HYPERLINK("x") <img src=x onerror=alert(1)>', fix: 'Başına tek tırnak ekle' },
  { severity: 'Minor', where: 'dashboard/public/app.js:40', issue: 'Gereksiz yeniden çizim', fix: 'İmza karşılaştır' },
] }
const QA_FAIL = { kind: 'qa', pass: false, commands: ['node --test dashboard/test/'], checks: [
  { criterion: 'Her agent için token ve maliyet görünür', ok: true, evidence: 'test/server.test.mjs: v3 testi' },
  { criterion: 'Geçmiş kalıcı saklanır', ok: false, evidence: 'yeniden başlatınca 0 session' },
] }
const QA_OK = { kind: 'qa', pass: true, commands: ['node --test dashboard/test/'], checks: [
  { criterion: 'Her agent için token ve maliyet görünür', ok: true, evidence: 'v3 testi geçti' },
  { criterion: 'Geçmiş kalıcı saklanır', ok: true, evidence: 'kalıcılık testi geçti' },
] }

async function wait(s, sec, ms = 700) {
  s.tick(sec)
  await s.push()
  await sleep(ms)
}

// (1) Canlı session: orkestratör → keşif ve plan alt agent'ları → /feature run'ı (iki tur) → doküman agent'ı
async function liveSession() {
  const s = new Session('Akadirr1/claude-config')
  console.log(`→ ${BASE}  (1) canlı orkestra: ${s.id}`)
  s.turn('Panele token analizi, kalıcı geçmiş ve orkestratör görünürlüğü ekle')
  s.think()
  await wait(s, 4)
  s.tool('Bash', 'graphify query "dashboard server push"')
  await wait(s, 3)
  const ex = s.spawn('Map dashboard data flow', 'Explore', SONNET, 'Trace how /api/push data reaches the panel; list files and functions')
  const pl = s.spawn('Plan storage + cost model', 'Plan', OPUS, 'Design persistent ledger and cost computation')
  await wait(s, 2)
  for (const [tool, arg] of [['Bash', 'graphify path server.mjs app.js'], ['Grep', 'broadcast'], ['Read', 'dashboard/server.mjs'], ['Bash', 'graphify explain store']]) {
    s.workSub(ex, tool, arg, 0.8)
    s.workSub(pl, pick(['Read', 'Bash']), pick(['dashboard/public/app.js', 'graphify query "pricing"', 'node --check server.mjs']), 1.2)
    await wait(s, 6)
  }
  s.endSub(ex, 'done', 'Veri akışı: mod → POST /api/push → store.merge → SSE session yaması → app.js ingest')
  await wait(s, 3)
  s.endSub(pl, 'done', 'Defter: session başına JSON dosyası, satır bazlı analiz, fiyat tablosu ezilebilir')
  s.think()
  await wait(s, 4)

  const run = new Run(s)
  await wait(s, 2)
  const [ba] = run.start([['ba', 'Analiz', null, OPUS]])
  for (const [t, a] of [['Bash', 'graphify query "token usage"'], ['Read', 'workflows/feature.js'], ['Bash', 'git rev-parse HEAD']]) {
    run.work(ba, t, a)
    await wait(s, 7)
  }
  run.end(ba, 'done', SPEC)
  await wait(s, 2)
  let [dev] = run.start([['dev #1', 'Geliştirme', null, OPUS]])
  for (const [t, a] of [['Bash', 'graphify query "store"'], ['Edit', 'dashboard/store.mjs'], ['Edit', 'dashboard/server.mjs'], ['Bash', 'node --test dashboard/test/'], ['Bash', 'git commit -m "defter"']]) {
    run.work(dev, t, a, 1.5)
    await wait(s, 9)
  }
  run.end(dev, 'done', { kind: 'text', text: 'store.mjs eklendi, server.mjs bağlandı, 30 test geçti' })
  await wait(s, 2)
  let [cr, sr, qa] = run.start([
    ['code-review #1', 'Review', 'reviewer-high', OPUS],
    ['security-review #1', 'Review', 'reviewer-high', OPUS],
    ['qa #1', 'QA', null, HAIKU],
  ])
  for (let i = 0; i < 4; i++) {
    run.work(cr, pick(['Read', 'Bash']), pick(['dashboard/store.mjs', 'git diff abc..HEAD', 'graphify query "csv"']))
    run.work(sr, pick(['Read', 'Grep']), pick(['dashboard/server.mjs', 'innerHTML', 'Set-Cookie']))
    run.work(qa, 'Bash', i === 1 ? 'echo "<img src=x onerror=alert(1)>"' : 'node --test dashboard/test/', 0.5)
    await wait(s, 8)
  }
  run.end(cr, 'done', { kind: 'review', findings: [FIND.findings[1]] })
  run.end(sr, 'done', FIND)
  await wait(s, 2)
  run.end(qa, 'done', QA_FAIL)
  await wait(s, 3)
  ;[dev] = run.start([['dev #2', 'Geliştirme', null, OPUS]])
  for (const [t, a] of [['Read', 'dashboard/store.mjs'], ['Edit', 'dashboard/store.mjs'], ['Bash', 'node --test dashboard/test/']]) {
    run.work(dev, t, a, 1.2)
    await wait(s, 8)
  }
  run.end(dev, 'done', { kind: 'text', text: 'CSV kaçışı ve flush düzeltildi' })
  await wait(s, 2)
  ;[cr, sr, qa] = run.start([
    ['code-review #2', 'Review', 'reviewer-high', OPUS],
    ['security-review #2', 'Review', 'reviewer-high', OPUS],
    ['qa #2', 'QA', null, HAIKU],
  ])
  for (let i = 0; i < 3; i++) {
    run.work(cr, 'Bash', 'graphify query "csv escape"')
    run.work(sr, 'Read', 'dashboard/store.mjs')
    run.work(qa, 'Bash', 'node --test dashboard/test/', 0.5)
    await wait(s, 7)
  }
  run.end(cr, 'done', { kind: 'review', findings: [] })
  run.end(sr, 'done', { kind: 'review', findings: [] })
  run.end(qa, 'done', QA_OK)
  run.finish('done')
  await wait(s, 2)
  s.think()
  const docs = s.spawn('Write deploy notes for volume', 'general-purpose', SONNET, 'Write a short README section about the /app/data volume')
  for (const a of ['dashboard/Dockerfile', 'README.md']) {
    s.workSub(docs, a.endsWith('.md') ? 'Write' : 'Read', a, 0.6)
    await wait(s, 6)
  }
  s.endSub(docs, 'done', 'README: Coolify Storages → /app/data')
  s.tool('Bash', 'git commit -m "README: kalıcı defter volume notu"')
  s.tool('Bash', 'gh pr create --draft')
  s.pr(7)
  await wait(s, 2)
  s.idle('Hepsi hazır: defter kalıcı, maliyet ekranı ve orkestratör paneli eklendi.')
  await wait(s, 1)
  return s
}

// (2) Başka repo: hata veren ve durdurulan run'lar, takılan bir alt agent
async function troubled() {
  const s = new Session('acme/web-app')
  console.log('→ (2) hata ve durdurma')
  s.turn('Ödeme sayfasını yeni API\'ye taşı')
  s.think()
  await wait(s, 3)
  const r1 = new Run(s)
  const [ba] = r1.start([['ba', 'Analiz', null, OPUS]])
  for (const a of ['src/pay.ts', 'graphify query "checkout"']) {
    r1.work(ba, a.startsWith('graphify') ? 'Bash' : 'Read', a)
    await wait(s, 5)
  }
  r1.end(ba, 'done', SPEC)
  const [dev] = r1.start([['dev #1', 'Geliştirme', null, OPUS]])
  for (const a of ['src/pay.ts', 'npm test']) {
    r1.work(dev, a.includes(' ') ? 'Bash' : 'Edit', a, 1.4)
    await wait(s, 6)
  }
  r1.end(dev, 'failed')
  r1.finish('failed')
  await wait(s, 3)
  const r2 = new Run(s)
  const [ba2] = r2.start([['ba', 'Analiz', null, OPUS]])
  r2.work(ba2, 'Read', 'src/pay.ts')
  await wait(s, 4)
  r2.end(ba2, 'done', SPEC)
  const [dev2] = r2.start([['dev #1', 'Geliştirme', null, OPUS]])
  r2.work(dev2, 'Edit', 'src/pay.ts', 1.2)
  await wait(s, 5)
  r2.end(dev2, 'done', { kind: 'text', text: 'taşındı' })
  const [c, q] = r2.start([['code-review #1', 'Review', 'reviewer-medium', SONNET], ['qa #1', 'QA', null, HAIKU]])
  r2.work(c, 'Read', 'src/pay.ts')
  r2.work(q, 'Bash', 'npm test', 0.5)
  await wait(s, 6)
  r2.finish('stopped')
  const stuck = s.spawn('Investigate flaky checkout e2e', 'general-purpose', SONNET, 'Find why checkout e2e fails intermittently')
  s.workSub(stuck, 'Bash', 'npx playwright test checkout --repeat-each 20', 2)
  s.idle('İki run sorunlu bitti; e2e araştırması sürüyor.')
  await wait(s, 2)
  return s
}

// (3) Geçmiş: son N güne yayılmış, farklı sınıf ve maliyetlerde session'lar
async function history(days) {
  console.log(`→ (3) ${days} günlük geçmiş`)
  const now = Date.now()
  const repos = ['Akadirr1/claude-config', 'acme/web-app', 'acme/billing-api']
  const kinds = [
    ['Map auth module', 'Explore', SONNET], ['Find dead code', 'Explore', HAIKU], ['Plan migration', 'Plan', OPUS],
    ['implement-rate-limit', 'general-purpose', OPUS], ['fix flaky test', 'general-purpose', SONNET],
    ['review payment diff', 'reviewer-high', OPUS], ['security audit cookies', 'reviewer-xhigh', OPUS],
    ['verify release build', 'general-purpose', HAIKU], ['write changelog', 'general-purpose', HAIKU],
    ['dashboard palette mockup', 'general-purpose', SONNET], ['coolify deploy check', 'general-purpose', HAIKU],
    ['summarize findings', 'general-purpose', SONNET],
  ]
  for (let d = days; d >= 1; d--) {
    const n = rnd() < 0.25 ? 0 : between(1, 3)
    for (let k = 0; k < n; k++) {
      const s = new Session(pick(repos), now - d * 86400e3 + between(8, 20) * 3600e3)
      s.turn(pick(['Ödeme akışını sadeleştir', 'Login hız sınırı ekle', 'CI süresini düşür', 'Panel tasarımını yenile', 'Bağımlılıkları güncelle']))
      for (let i = 0; i < between(3, 12); i++) {
        s.think()
        s.tool(pick(['Bash', 'Read', 'Edit', 'Grep']), pick(['graphify query "x"', 'src/a.ts', 'npm test', 'TODO']))
        s.tick(between(20, 90))
      }
      for (let i = 0; i < between(1, 6); i++) {
        const [label, type, model] = pick(kinds)
        const sub = s.spawn(label, type, model, label)
        const graphFirst = rnd() < 0.5
        for (let j = 0; j < between(2, 9); j++) {
          s.workSub(sub, graphFirst && j === 0 ? 'Bash' : pick(['Read', 'Grep', 'Edit', 'Bash']), graphFirst && j === 0 ? 'graphify query "ctx"' : 'src/x.ts', graphFirst ? 0.6 : 1.3)
          s.tick(between(15, 70))
        }
        s.endSub(sub, rnd() < 0.08 ? 'failed' : 'done', 'tamam')
      }
      if (rnd() < 0.45) {
        const r = new Run(s, pick(['feature', 'feature', 'review-changes', 'migrate']))
        const [ba] = r.start([['ba', 'Analiz', null, OPUS]])
        r.work(ba, 'Bash', 'graphify query "spec"')
        s.tick(between(60, 200))
        r.end(ba, 'done', SPEC)
        const rounds = between(1, 3)
        for (let k2 = 1; k2 <= rounds; k2++) {
          const [dv] = r.start([[`dev #${k2}`, 'Geliştirme', null, OPUS]])
          for (let j = 0; j < between(2, 6); j++) r.work(dv, 'Edit', 'src/y.ts', 1.4), s.tick(between(30, 120))
          r.end(dv, 'done')
          const trio = r.start([[`code-review #${k2}`, 'Review', 'reviewer-high', OPUS], [`security-review #${k2}`, 'Review', 'reviewer-high', OPUS], [`qa #${k2}`, 'QA', null, HAIKU]])
          for (const a of trio) r.work(a, 'Read', 'src/y.ts'), r.work(a, 'Bash', 'npm test', 0.6)
          s.tick(between(60, 240))
          for (const a of trio) r.end(a, 'done', a.label.startsWith('qa') ? (k2 === rounds ? QA_OK : QA_FAIL) : { kind: 'review', findings: k2 === rounds ? [] : FIND.findings })
        }
        r.finish(rnd() < 0.85 ? 'done' : 'failed')
      }
      s.idle('bitti')
      await s.push()
    }
  }
}

try {
  if (HISTORY) await history(HISTORY)
  await Promise.all([liveSession(), (async () => (await sleep(1500), troubled()))()])
  console.log('bitti')
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
