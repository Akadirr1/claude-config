#!/usr/bin/env node
// Panel için sahte /feature run'ları: gerçek run başlatmadan sözleşmedeki v:2 payload'larını
// adım adım POST /api/push'a yollar (her adımda session'ın bütün run listesi, mod gibi).
// Kullanım: WF_MONITOR_TOKEN=... node dashboard/dev/simulate.mjs [http://localhost:3000] [--fast]
import { randomBytes } from 'node:crypto'

const argv = process.argv.slice(2)
const BASE = (argv.find(a => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '')
const FAST = argv.includes('--fast')
const TOKEN = process.env.WF_MONITOR_TOKEN
if (!TOKEN) {
  console.error('WF_MONITOR_TOKEN gerekli')
  process.exit(1)
}

const PHASES = ['Analiz', 'Geliştirme', 'Review', 'QA']
const PHASE_OF = { ba: 'Analiz', dev: 'Geliştirme', review: 'Review', qa: 'QA' }
const hex = n => randomBytes(n).toString('hex')
const sleep = ms => new Promise(r => setTimeout(r, ms))
let clock = Date.now() // mod saati; her adımda sanal saniyelerle ilerler

class Session {
  constructor(repo) {
    this.id = `session_${hex(12)}`
    this.repo = repo
    this.runs = []
  }
  async push() {
    const body = { v: 2, session: { id: this.id, repo: this.repo }, sentAt: clock, runs: this.runs.slice(-10).map(r => r.data) }
    const res = await fetch(`${BASE}/api/push`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`push ${res.status} ${res.statusText}`)
  }
}

class Run {
  constructor(session) {
    this.prev = [] // son dalga
    this.wave = -1
    this.data = { taskId: `task_${hex(6)}`, name: 'feature', status: 'running', startedAt: clock, endedAt: null, phases: PHASES, agents: [], edges: [] }
    session.runs.push(this)
  }
  // Aynı anda başlayanlar bir dalga; önceki dalganın her agent'ından yenilere kenar.
  // loop: hedefin turu büyük ya da phase'i kaynaktan önce.
  start(...labels) {
    this.wave++
    const made = labels.map(label => {
      const kind = label.split(' ')[0]
      const role = kind === 'ba' || kind === 'dev' || kind === 'qa' ? kind : kind.endsWith('review') ? 'review' : 'other'
      const a = {
        id: `agent_${hex(8)}`, label, phase: PHASE_OF[role] ?? null, round: Number(/#(\d+)/.exec(label)?.[1] ?? 1), role,
        status: 'running', startedAt: clock, endedAt: null, wave: this.wave, steps: [], result: null,
      }
      this.data.agents.push(a)
      for (const p of this.prev) {
        const loop = a.round > p.round || PHASES.indexOf(a.phase) < PHASES.indexOf(p.phase)
        this.data.edges.push({ from: p.id, to: a.id, kind: loop ? 'loop' : 'handoff' })
      }
      return a
    })
    this.prev = made
    return made
  }
  step(a, text) {
    a.steps = [...a.steps, { t: clock, text: text.slice(0, 160) }].slice(-10)
  }
  end(a, status, result = null) {
    Object.assign(a, { status, endedAt: clock, result })
  }
  finish(status) {
    for (const a of this.data.agents) if (a.status === 'running') this.end(a, 'stopped')
    Object.assign(this.data, { status, endedAt: clock })
  }
}

// sec sanal saniye ilerle, değişikliği uygula, push et, biraz bekle
async function beat(s, sec, fn) {
  clock += sec * 1000
  fn?.()
  await s.push()
  await sleep(FAST ? 120 : 1100)
}
// [agent, saniye, metin] adımlarını sırayla oynat (paralel agent'lar karışık sırayla)
async function play(s, r, list) {
  for (const [a, sec, text] of list) await beat(s, sec, () => r.step(a, text))
}

async function scenarioPass(s) {
  const r = new Run(s)
  let ba, dev, cr, sr, qa
  await beat(s, 0, () => ([ba] = r.start('ba')))
  await play(s, r, [
    [ba, 5, 'Bash: git rev-parse HEAD'],
    [ba, 9, 'Bash: graphify query "invoice export rate limit"'],
    [ba, 12, 'Read src/routes/invoices.ts'],
    [ba, 8, 'Grep "rateLimit" src --type ts'],
    [ba, 10, 'Read src/middleware/rate-limit.ts'],
  ])
  await beat(s, 16, () => r.end(ba, 'done', {
    kind: 'spec',
    criteria: [
      'GET /invoices/:id/pdf kullanıcı başına dakikada 10 istekle sınırlı; aşınca 429 + Retry-After döner',
      'Sınır aşımı logger.warn ile kullanıcı id ve rota bilgisiyle loglanır',
      'Mevcut invoice testleri geçmeye devam eder',
    ],
    files: ['src/routes/invoices.ts', 'src/middleware/rate-limit.ts', 'test/invoices.pdf.test.ts'],
    outOfScope: ['Diğer export uçları (CSV, XLSX)', 'Redis tabanlı dağıtık sayaç'],
    risks: ['Tek instance varsayıldı; birden fazla pod varsa sayaç pod başına olur'],
  }))

  await beat(s, 2, () => ([dev] = r.start('dev #1')))
  await play(s, r, [
    [dev, 7, 'Read src/middleware/rate-limit.ts'],
    [dev, 14, 'Edit src/middleware/rate-limit.ts'],
    [dev, 11, 'Edit src/routes/invoices.ts'],
    [dev, 18, 'Write test/invoices.pdf.test.ts'],
    [dev, 22, 'Bash: npm test -- invoices'],
    [dev, 9, 'Bash: git commit -m "invoice pdf: kullanıcı başına rate limit"'],
  ])
  await beat(s, 6, () => r.end(dev, 'done', { kind: 'text', text: 'rate-limit.ts: perUser(key, limit, windowMs) eklendi; invoices.ts PDF rotasına bağlandı. 429 için test yazıldı, 41 test geçti. Commit: 7c1e9a2' }))

  await beat(s, 2, () => ([cr, sr, qa] = r.start('code-review #1', 'security-review #1', 'qa #1')))
  await play(s, r, [
    [cr, 4, 'Bash: git diff 3f2a91c..HEAD'],
    [sr, 2, 'Bash: git diff 3f2a91c..HEAD --stat'],
    [qa, 3, 'Read package.json'],
    [cr, 9, 'Read src/middleware/rate-limit.ts'],
    [sr, 6, 'Grep "Content-Disposition" src'],
    [qa, 7, 'Bash: npm test'],
    [sr, 8, 'Grep "<img src=x onerror=alert(1)>" test/fixtures'],
    [cr, 11, 'Read test/invoices.pdf.test.ts'],
    [sr, 10, 'Read src/routes/invoices.ts'],
    [qa, 14, 'Bash: npm run lint'],
  ])
  await beat(s, 8, () => r.end(cr, 'done', { kind: 'review', findings: [
    { severity: 'Minor', where: 'src/middleware/rate-limit.ts:18', issue: 'Süresi dolan anahtarlar Map’ten hiç silinmiyor.', fix: 'Pencere bitince anahtarı sil ya da setInterval ile temizle.' },
  ] }))
  await beat(s, 6, () => r.end(sr, 'done', { kind: 'review', findings: [
    { severity: 'Important', where: 'src/routes/invoices.ts:52', issue: 'Dosya adı filtrelenmeden Content-Disposition başlığına yazılıyor: <img src=x onerror=alert(1)>', fix: 'Dosya adını [A-Za-z0-9._-] dışındakilerden arındır ve filename* ile kodla.' },
    { severity: 'Minor', where: 'src/middleware/rate-limit.ts:7', issue: 'Anahtar IP’ye düşerse X-Forwarded-For güvenilmeden okunuyor.', fix: 'trust proxy ayarını kullan.' },
  ] }))
  await beat(s, 7, () => r.end(qa, 'done', { kind: 'qa', pass: false, commands: ['npm test', 'npm run lint'], checks: [
    { criterion: '10 istek sonrası 429 + Retry-After', ok: true, evidence: 'test/invoices.pdf.test.ts:31 "returns 429 after 10 requests" geçti' },
    { criterion: 'Sınır aşımı loglanır', ok: false, evidence: 'logger.warn çağrısı yok; src/middleware/rate-limit.ts içinde log satırı bulunamadı' },
    { criterion: 'Mevcut testler geçer', ok: true, evidence: 'npm test: 41 passed, 0 failed' },
  ] }))

  await beat(s, 2, () => ([dev] = r.start('dev #2')))
  await play(s, r, [
    [dev, 6, 'Read src/routes/invoices.ts'],
    [dev, 12, 'Edit src/routes/invoices.ts'],
    [dev, 9, 'Edit src/middleware/rate-limit.ts'],
    [dev, 15, 'Bash: npm test'],
    [dev, 5, 'Bash: git commit -m "content-disposition kaçışı, 429 log"'],
  ])
  await beat(s, 4, () => r.end(dev, 'done', { kind: 'text', text: 'Dosya adı arındırıldı ve filename* ile kodlandı; sınır aşımı logger.warn ile loglanıyor. 43 test geçti.' }))

  await beat(s, 2, () => ([cr, sr, qa] = r.start('code-review #2', 'security-review #2', 'qa #2')))
  await play(s, r, [
    [cr, 4, 'Bash: git diff 3f2a91c..HEAD'],
    [qa, 3, 'Bash: npm test'],
    [sr, 5, 'Read src/routes/invoices.ts'],
    [cr, 8, 'Read src/middleware/rate-limit.ts'],
    [sr, 7, 'Grep "filename" src'],
    [qa, 12, 'Bash: npm run lint'],
  ])
  await beat(s, 6, () => r.end(cr, 'done', { kind: 'review', findings: [] }))
  await beat(s, 4, () => r.end(sr, 'done', { kind: 'review', findings: [] }))
  await beat(s, 5, () => r.end(qa, 'done', { kind: 'qa', pass: true, commands: ['npm test', 'npm run lint'], checks: [
    { criterion: '10 istek sonrası 429 + Retry-After', ok: true, evidence: 'test/invoices.pdf.test.ts:31 geçti' },
    { criterion: 'Sınır aşımı loglanır', ok: true, evidence: 'test/invoices.pdf.test.ts:48 "logs rate limit hit" geçti' },
    { criterion: 'Mevcut testler geçer', ok: true, evidence: 'npm test: 43 passed' },
  ] }))
  await beat(s, 1, () => r.finish('done'))
}

async function scenarioFail(s) {
  const r = new Run(s)
  let ba, dev
  await beat(s, 0, () => ([ba] = r.start('ba')))
  await play(s, r, [
    [ba, 4, 'Bash: git rev-parse HEAD'],
    [ba, 10, 'Read src/theme/tokens.css'],
    [ba, 7, 'Grep "prefers-color-scheme" src'],
  ])
  await beat(s, 12, () => r.end(ba, 'done', {
    kind: 'spec',
    criteria: ['Ayarlar sayfasında koyu/açık tema anahtarı', 'Seçim localStorage’da saklanır', 'Sistem teması varsayılan'],
    files: ['src/theme/tokens.css', 'src/pages/Settings.tsx', 'src/theme/useTheme.ts'],
    outOfScope: ['E-posta şablonları'],
    risks: ['SSR sırasında localStorage yok; ilk boyamada tema titreyebilir'],
  }))
  await beat(s, 2, () => ([dev] = r.start('dev #1')))
  await play(s, r, [
    [dev, 8, 'Write src/theme/useTheme.ts'],
    [dev, 13, 'Edit src/pages/Settings.tsx'],
    [dev, 9, 'Bash: npm run build'],
  ])
  await beat(s, 40, () => r.end(dev, 'failed', { kind: 'text', text: 'Agent hata verdi: Bash "npm run build" 600 sn içinde bitmedi (vite süreci yanıt vermedi). Değişiklikler commit edilmedi.' }))
  await beat(s, 1, () => r.finish('failed'))
}

async function scenarioStop(s) {
  const r = new Run(s)
  let ba, dev, cr, sr, qa
  await beat(s, 0, () => ([ba] = r.start('ba')))
  await play(s, r, [[ba, 6, 'Read src/routes/reports.ts'], [ba, 9, 'Grep "toCsv" src']])
  await beat(s, 11, () => r.end(ba, 'done', {
    kind: 'spec',
    criteria: ['GET /reports/:id.csv RFC 4180 uyumlu CSV döner', 'Virgül ve tırnak içeren alanlar kaçışlanır'],
    files: ['src/routes/reports.ts', 'src/lib/csv.ts'],
    outOfScope: [],
    risks: [],
  }))
  await beat(s, 2, () => ([dev] = r.start('dev #1')))
  await play(s, r, [[dev, 10, 'Write src/lib/csv.ts'], [dev, 12, 'Edit src/routes/reports.ts'], [dev, 14, 'Bash: npm test -- csv']])
  await beat(s, 5, () => r.end(dev, 'done', { kind: 'text', text: 'csv.ts eklendi, rota bağlandı, 6 yeni test.' }))
  await beat(s, 2, () => ([cr, sr, qa] = r.start('code-review #1', 'security-review #1', 'qa #1')))
  await play(s, r, [[cr, 4, 'Bash: git diff 91ab02e..HEAD'], [qa, 3, 'Bash: npm test'], [sr, 5, 'Read src/lib/csv.ts']])
  await beat(s, 9, () => r.finish('stopped'))
}

try {
  const a = new Session('acme/billing-api')
  const b = new Session('acme/web-app')
  console.log(`→ ${BASE}  (1) geçen run, iki tur`)
  await scenarioPass(a)
  console.log('→ (2) dev aşamasında hata')
  await scenarioFail(b)
  console.log('→ (3) review sırasında durdurulan run')
  await scenarioStop(a)
  console.log('bitti')
} catch (e) {
  console.error(`simülasyon durdu: ${e.message}`)
  process.exit(1)
}
