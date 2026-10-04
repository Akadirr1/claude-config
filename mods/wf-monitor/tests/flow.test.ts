import { describe, expect, mock, test } from 'claude-code/testing'
import { fit, mask } from '../hooks/register.js'

const DIR = '/s/workflows/run1'
const SCRIPT = `export const meta = {
  name: 'feature',
  description: 'x',
  phases: [{ title: 'Analiz' }, { title: 'Geliştirme' }, { title: 'Review' }, { title: 'QA' }],
}
phase('Analiz')
`
const PANE = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'wf-monitor',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Workflow', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const WF = { command: 'wf', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } }
const STOP = { stop_hook_active: false, background_tasks: [] }

const SPEC = { head: 'abc', criteria: ['c1', 'c2'], files: ['a.js'], outOfScope: [], risks: ['r1'] }
const REVIEW = { findings: [{ severity: 'Important', where: 'a.js:3', issue: 'x', fix: 'y' }] }
const QA = { pass: false, commands: ['npm test'], checks: [{ criterion: 'c1', ok: false, evidence: 'fail' }] }

// feature.js'in ilk turu: 5 agent, 11 satır (launched + 5 started + 5 result)
const ROUND1 = [
  { type: 'launched' },
  { type: 'started', key: 'k1', agentId: 'ba000001' },
  { type: 'result', key: 'k1', agentId: 'ba000001', result: SPEC },
  { type: 'started', key: 'k2', agentId: 'dev00001' },
  { type: 'result', key: 'k2', agentId: 'dev00001', result: 'değişti: a.js' },
  { type: 'started', key: 'k3', agentId: 'cr000001' },
  { type: 'started', key: 'k4', agentId: 'sr000001' },
  { type: 'started', key: 'k5', agentId: 'qa000001' },
  { type: 'result', key: 'k3', agentId: 'cr000001', result: REVIEW },
  { type: 'result', key: 'k4', agentId: 'sr000001', result: { findings: [] } },
  { type: 'result', key: 'k5', agentId: 'qa000001', result: QA },
]
const DEV2 = { type: 'started', key: 'k6', agentId: 'dev00002' }
const META = {
  ba000001: { description: 'ba', workflowPhase: 'Analiz' },
  dev00001: { description: 'dev #1', workflowPhase: 'Geliştirme' },
  cr000001: { description: 'code-review #1', workflowPhase: 'Review', agentType: 'reviewer-high' },
  sr000001: { description: 'security-review #1', workflowPhase: 'Review', agentType: 'reviewer-high' },
  qa000001: { description: 'qa #1', workflowPhase: 'QA' },
  dev00002: { description: 'dev #2', workflowPhase: 'Geliştirme' },
}
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n'

function textOf(t) {
  if (typeof t === 'string' || typeof t === 'number') return String(t)
  if (Array.isArray(t)) return t.map(textOf).join('\n')
  if (!t || typeof t !== 'object') return ''
  return textOf(t.children ?? t.props?.children ?? [])
}

// files: transcriptDir altındaki dosyalar (ad -> içerik); ctl: testlerin değiştirdiği davranışlar
function world(on, surfaces, env = {}, rows = ROUND1, repo = { root: '/w/claude-config', remote: 'https://github.com/Akadirr1/claude-config' }) {
  const clock = mock.clock(on, { now: 1000 })
  const ctl = { slowList: false, slowMeta: false, noSize: false, postOk: true, postHang: false, lists: 0 }
  const files = { 'journal.jsonl': jsonl(rows) }
  for (const [id, m] of Object.entries(META)) files[`agent-${id}.meta.json`] = JSON.stringify(m)
  const reads = []
  const posts = []
  mock.env(on, env)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.repo', () => ({ value: repo }))
  on('session.start', ($, e) => e)
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('fs.read', async ($, e) => {
    const path = String(e.path ?? e)
    reads.push(path)
    const name = path.split('/').pop()
    if (ctl.slowMeta && name.endsWith('.meta.json')) await clock.sleep(300)
    if (name in files) return { value: files[name] }
    if (name === 'script.js') return { value: SCRIPT }
    throw new Error('ENOENT ' + path)
  })
  on('fs.list', async () => {
    ctl.lists++
    if (ctl.slowList) await clock.sleep(300)
    return {
      value: Object.entries(files).map(([name, text]) => ({
        name,
        kind: 'file',
        ...(ctl.noSize ? {} : { size: text.length }),
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('http.fetch', async ($, e) => {
    posts.push(e)
    if (ctl.postHang) await clock.sleep(30_000)
    return { value: { status: ctl.postOk ? 204 : 503, ok: ctl.postOk, headers: {}, text: '' } }
  })
  on('tool.call', { tool: 'Workflow' }, ($, e) => ({
    result: { status: 'async_launched', taskId: e.tid ?? 't1', workflowName: 'feature', transcriptDir: DIR, scriptPath: DIR + '/script.js' },
  }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('classic.Stop', () => ({}))
  return { clock, files, reads, posts, ctl }
}

const POST_ENV = { WF_MONITOR_URL: 'https://wf.example/api/push', WF_MONITOR_TOKEN: 'sir' }

function lastPost(posts) {
  const last = posts[posts.length - 1]
  const [url, init] = Array.isArray(last) ? last : [last.url, last.init]
  return { url, init, body: JSON.parse(init.body) }
}

async function launch($) {
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', name: 'feature' })
}

const notify = (id, status) => ({
  text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>x</summary>\n</task-notification>`,
  origin: { kind: 'task-notification' },
  wait: false,
})

describe('wf-monitor', () => {
  test('workflow yokken /wf bunu söyler', async ($, on) => {
    world(on, [])
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    expect(await $.command.run(WF)).toEqual({ text: "Bu session'da workflow çalışmadı." })
  })

  test('biten sayısı journal satırından değil result\'tan gelir', async ($, on) => {
    const { clock } = world(on, ['terminal'])
    await launch($)
    await clock.advance(2100)
    const drawn = textOf(await $.ui.render(PANE))
    expect(drawn).toContain('feature · çalışıyor')
    expect(drawn).toContain('başlayan 5  aktif 0  biten 5')
    expect(drawn).toContain('Analiz → Geliştirme → Review → QA')
    expect(drawn).toContain('son dönen: qa #1')
    expect((await $.command.run(WF)).text).toContain('başlayan 5 / aktif 0 / biten 5')
  })

  test('aktif agent label + son adımı; Stop listesinde yok ve bitmemiş agent varsa durduruldu', async ($, on) => {
    const { clock } = world(on, ['terminal'], {}, [...ROUND1, DEV2])
    await launch($)
    await $.tool.call({ tool: 'Bash', command: 'npm test -- --run', agentId: 'dev00002' })
    await clock.advance(2100)
    expect(textOf(await $.ui.render(PANE))).toContain('dev #2 Bash: npm test -- --run')
    await $.classic.Stop(STOP)
    const text = (await $.command.run(WF)).text
    expect(text).toContain('feature · durduruldu')
    expect(text).toContain('başlayan 6 / aktif 0 / biten 5')
  })

  test('Stop listesinde yok ve hepsi bittiyse bitti; sonradan gelen bildirim tahmini düzeltir', async ($, on) => {
    const { clock } = world(on, [])
    await launch($)
    await clock.advance(2100)
    await $.classic.Stop(STOP)
    expect((await $.command.run(WF)).text).toContain('feature · bitti')
    await $.prompt.submit(notify('t1', 'failed'))
    expect((await $.command.run(WF)).text).toContain('feature · hata')
    // kesin durumu tahmin ezmez
    await $.classic.Stop(STOP)
    await $.prompt.submit(notify('t1', 'completed'))
    expect((await $.command.run(WF)).text).toContain('feature · hata')
  })

  test('killed bildirimi run\'ı ve süren agent\'ı durdurulmuş yapar', async ($, on) => {
    const { clock, posts } = world(on, [], POST_ENV, [...ROUND1, DEV2])
    await launch($)
    await clock.advance(2100)
    await $.prompt.submit(notify('t1', 'killed'))
    expect((await $.command.run(WF)).text).toContain('feature · durduruldu')
    const run = lastPost(posts).body.runs[0]
    expect(run.status).toBe('stopped')
    expect(run.endedAt).toBe(3100)
    const dev2 = run.agents.find(a => a.id === 'dev00002')
    expect(dev2.status).toBe('stopped')
    expect(dev2.endedAt).toBe(3100)
  })

  test('TaskStop ile durdurulan run durduruldu olur', async ($, on) => {
    const { clock } = world(on, [])
    on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'ok', task_id: 't1', task_type: 'local_workflow' } }))
    await launch($)
    await clock.advance(2100)
    await $.tool.call({ tool: 'TaskStop', task_id: 't1' })
    expect((await $.command.run(WF)).text).toContain('feature · durduruldu')
  })

  test('payload v2 şekli: label/phase meta\'dan, dalgalar, kenarlar ve sonuç özetleri', async ($, on) => {
    const { clock, posts } = world(on, [], POST_ENV, [...ROUND1, DEV2])
    await launch($)
    await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'dev00002' })
    await clock.advance(2100)
    const { url, init, body } = lastPost(posts)
    expect(url).toBe('https://wf.example/api/push')
    expect(init.headers.Authorization).toBe('Bearer sir')
    expect(body.v).toBe(2)
    expect(body.sentAt).toBe(3000) // poll: 1000 + 2000
    expect(body.session).toEqual({ id: 'sess-1', repo: 'Akadirr1/claude-config' })
    const run = body.runs[0]
    expect(run).toEqual(
      expect.objectContaining({ taskId: 't1', name: 'feature', status: 'running', startedAt: 1000, endedAt: null }),
    )
    expect(run.phases).toEqual(['Analiz', 'Geliştirme', 'Review', 'QA'])
    expect(run.agents.map(a => [a.label, a.phase, a.round, a.role, a.wave, a.status])).toEqual([
      ['ba', 'Analiz', 1, 'ba', 0, 'done'],
      ['dev #1', 'Geliştirme', 1, 'dev', 1, 'done'],
      ['code-review #1', 'Review', 1, 'review', 2, 'done'],
      ['security-review #1', 'Review', 1, 'review', 2, 'done'],
      ['qa #1', 'QA', 1, 'qa', 2, 'done'],
      ['dev #2', 'Geliştirme', 2, 'dev', 3, 'running'],
    ])
    const dev2 = run.agents[5]
    expect(dev2.startedAt).toBe(1000) // ilk tool.call poll'dan önce
    expect(dev2.endedAt).toBe(null)
    expect(dev2.steps).toEqual([{ t: 1000, text: 'Bash: npm test' }])
    expect(run.agents[0].endedAt).toBe(3000)
    expect(run.agents[0].result).toEqual({ kind: 'spec', criteria: ['c1', 'c2'], files: ['a.js'], outOfScope: [], risks: ['r1'] })
    expect(run.agents[1].result).toEqual({ kind: 'text', text: 'değişti: a.js' })
    expect(run.agents[2].result).toEqual({ kind: 'review', findings: REVIEW.findings })
    expect(run.agents[4].result).toEqual({ kind: 'qa', pass: false, commands: ['npm test'], checks: QA.checks })
    expect(run.edges).toEqual([
      { from: 'ba000001', to: 'dev00001', kind: 'handoff' },
      { from: 'dev00001', to: 'cr000001', kind: 'handoff' },
      { from: 'dev00001', to: 'sr000001', kind: 'handoff' },
      { from: 'dev00001', to: 'qa000001', kind: 'handoff' },
      { from: 'cr000001', to: 'dev00002', kind: 'loop' },
      { from: 'sr000001', to: 'dev00002', kind: 'loop' },
      { from: 'qa000001', to: 'dev00002', kind: 'loop' },
    ])
  })

  test('payload\'daki metinler maskelenir', async ($, on) => {
    const secretResult = { type: 'result', key: 'k6', agentId: 'dev00002', result: 'anahtar sk-abcdefghijklmnop1234 ve password=hunter2' }
    const { clock, posts } = world(on, [], POST_ENV, [...ROUND1, DEV2, secretResult])
    await launch($)
    await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer s3cr3tvalue" https://x/api?token=zzzsecret', agentId: 'dev00002' })
    await clock.advance(2100)
    const raw = lastPost(posts).init.body
    for (const s of ['s3cr3tvalue', 'zzzsecret', 'abcdefghijklmnop1234', 'hunter2']) expect(raw.includes(s)).toBe(false)
    expect(raw).toContain('token=***')
    expect(raw).toContain('sk-***')
  })

  test('mask: bilinen biçimler', async () => {
    expect(mask('Authorization: Bearer abc.def')).not.toContain('abc.def')
    expect(mask('x?token=abc&y=1')).toBe('x?token=***&y=1')
    expect(mask('{"api_key":"a b c","n":1}')).toBe('{"api_key":"***","n":1}')
    expect(mask('secret: hello world')).toBe('secret: *** world')
    expect(mask('ghp_ABCDEFGHIJKLMNOPQRST github_pat_ABCDEFGHIJ12345 xoxb-1234567890-abc AKIAABCDEFGHIJKLMNOP')).toBe(
      'ghp_*** github_pat_*** xoxb-*** AKIA***',
    )
    expect(mask('eyJhbGciOi.eyJzdWIiOiIx.sig_part')).toBe('***')
    expect(mask(mask('token=abc'))).toBe('token=***')
    expect(mask('dev #2 bitti')).toBe('dev #2 bitti')
  })

  test('256 KB: en eski bitmiş run atılır, sınırın altında kalır', async () => {
    const big = i => ({
      taskId: 't' + i,
      status: i < 2 ? 'done' : 'running',
      agents: [{ id: 'a' + i, steps: [], result: { kind: 'text', text: 'x'.repeat(100_000) } }],
      edges: [],
    })
    const body = { v: 2, runs: [big(0), big(1), big(2)] }
    const s = fit(body)
    expect(new TextEncoder().encode(s).length < 256 * 1024).toBe(true)
    expect(JSON.parse(s).runs.map(r => r.taskId)).toEqual(['t1', 't2'])

    const many = { v: 2, runs: [{ taskId: 'r', status: 'running', agents: [], edges: [] }] }
    for (let i = 0; i < 3000; i++) many.runs[0].agents.push({ id: 'a' + i, steps: [{ t: 1, text: 'y'.repeat(150) }], result: null })
    const s2 = fit(many)
    expect(new TextEncoder().encode(s2).length < 256 * 1024).toBe(true)
    expect(JSON.parse(s2).runs[0].agents.length > 0).toBe(true)
  })

  test('journal yalnız boyutu değişince yeniden okunur; değişiklik yoksa 15 sn heartbeat', async ($, on) => {
    const { clock, files, reads, posts } = world(on, [], POST_ENV)
    await launch($)
    await clock.advance(2100)
    await clock.advance(2000)
    await clock.advance(2000)
    expect(reads.filter(p => p.endsWith('journal.jsonl')).length).toBe(1)
    const before = posts.length
    files['journal.jsonl'] += JSON.stringify(DEV2) + '\n'
    await clock.advance(2000)
    expect(reads.filter(p => p.endsWith('journal.jsonl')).length).toBe(2)
    expect(posts.length).toBe(before + 1)
    await clock.advance(10000)
    expect(posts.length).toBe(before + 1)
    await clock.advance(6000)
    expect(posts.length).toBe(before + 2)
  })

  // 1
  test('mask: 100K karakterlik girdi 100 ms altında; uzun komut adımı kırpılır', async ($, on) => {
    for (const s of ['a'.repeat(100_000), '0123456789abcdef'.repeat(6250), 'token'.repeat(20_000), 'key="'.repeat(20_000)]) {
      const t0 = Date.now()
      mask(s)
      expect(Date.now() - t0 < 100).toBe(true)
    }
    const { clock, posts } = world(on, [], POST_ENV, [...ROUND1, DEV2])
    await launch($)
    await $.tool.call({ tool: 'Bash', command: 'echo ' + 'a'.repeat(100_000), agentId: 'dev00002' })
    await clock.advance(2100)
    const step = lastPost(posts).body.runs[0].agents[5].steps[0].text
    expect(step.length <= 160).toBe(true)
    expect(step.startsWith('Bash: echo aaa')).toBe(true)
  })

  // 2
  test('mask: URL kullanıcı bilgisi, özel anahtar, bayraklar, curl -u, sağlayıcı önekleri, pass/pwd/auth', async () => {
    expect(mask('git clone https://user:hunter2@github.com/o/r')).toBe('git clone https://***@github.com/o/r')
    expect(mask('postgres://admin:s3cret@db:5432/x')).toBe('postgres://***@db:5432/x')
    expect(mask('a -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY----- b')).toBe('a [private key ***] b')
    expect(mask('k: -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz')).toBe('k: [private key ***]')
    expect(mask('mysql --password hunter2 -h x')).toBe('mysql --password *** -h x')
    expect(mask('tool --token=abc123 --passwd "a b"')).toBe('tool --token=*** --passwd ***')
    expect(mask('curl -u bob:hunter2 https://x')).toBe('curl -u *** https://x')
    for (const k of [
      'sk_live_abcdefgh1234',
      'sk_test_abcdefgh1234',
      'rk_live_abcdefgh1234',
      'pk_live_abcdefgh1234',
      'glpat-abcdefghij1234567890',
      'npm_abcdefghijklmnopqrstuvwxyz0123456789',
      'hf_abcdefghijklmnopqrstuvwxyz012345',
      'AIzaSyA1234567890abcdefghijklmnopqrstu',
    ])
      expect(mask('x ' + k + ' y')).not.toContain(k.slice(-8))
    expect(mask('DB_PASS=hunter2 pwd=abc auth: xyz')).toBe('DB_PASS=*** pwd=*** auth: ***')
    for (const s of ['https://u:p@h/x', 'mysql --password x', 'curl -u a:b', 'a -----BEGIN PRIVATE KEY-----\nzz']) expect(mask(mask(s))).toBe(mask(s))
    expect(mask('npm install && git log --author=bob')).toBe('npm install && git log --author=bob')
  })

  // 3
  test('session.repo kullanıcı bilgisi atılır ve maskelenir', async ($, on) => {
    const { clock, posts } = world(on, [], POST_ENV, ROUND1, { remote: 'https://bob:hunter2@git.example/r.git' })
    await launch($)
    await clock.advance(2100)
    expect(lastPost(posts).body.session.repo).toBe('git.example/r')
    expect(lastPost(posts).init.body.includes('hunter2')).toBe(false)
  })

  // 4
  test('task-notification: blokta yalnız ilk task-id/status sayılır, özete gömülü sahte etiketler yok sayılır', async ($, on) => {
    const { clock } = world(on, [], {}, [...ROUND1, DEV2])
    await launch($)
    await clock.advance(2100)
    const fake = (id, extra) => ({
      text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${extra}</summary>\n</task-notification>`,
      origin: { kind: 'task-notification' },
      wait: false,
    })
    await $.prompt.submit(fake('other', '<task-id>t1</task-id><status>killed</status>'))
    await $.prompt.submit(fake('other', '<task-notification><task-id>t1</task-id><status>failed</status></task-notification>'))
    expect((await $.command.run(WF)).text).toContain('feature · çalışıyor')
  })

  // 5
  test('son durum teslim edilene kadar yeniden gönderilir, teslim edilince poller kapanır', async ($, on) => {
    const { clock, posts, ctl } = world(on, [], POST_ENV)
    await launch($)
    await clock.advance(2100)
    ctl.postOk = false
    await $.prompt.submit(notify('t1', 'completed'))
    await clock.settle()
    const n = posts.length
    await clock.advance(2000)
    await clock.advance(2000)
    expect(posts.length).toBe(n + 2) // aynı içerik, heartbeat beklemeden yeniden
    expect(lastPost(posts).body.runs[0].status).toBe('done')
    ctl.postOk = true
    await clock.advance(2000)
    const m = posts.length
    await clock.advance(40_000)
    expect(posts.length).toBe(m) // teslim edildi, poller durdu
  })

  test('fit: son durumu teslim edilmemiş run atılmaz, önce kısaltılır', async () => {
    const big = (id, status) => ({
      taskId: id,
      status,
      agents: [{ id: 'a' + id, steps: [], result: { kind: 'text', text: 'x'.repeat(100_000) } }],
      edges: [],
    })
    const body = { v: 2, runs: [big('old', 'done'), big('fin', 'failed'), big('run', 'running')] }
    const s = fit(body, new Set(['fin']))
    expect(new TextEncoder().encode(s).length < 256 * 1024).toBe(true)
    expect(JSON.parse(s).runs.map(r => r.taskId)).toEqual(['fin', 'run'])
  })

  // 6
  test('hook yolları HTTP beklemez', async ($, on) => {
    const { clock, ctl } = world(on, [], POST_ENV)
    await launch($)
    await clock.advance(2100)
    ctl.postHang = true
    await $.prompt.submit(notify('t1', 'failed'))
    await $.classic.Stop(STOP)
    expect((await $.command.run(WF)).text).toContain('feature · hata')
    await clock.advance(30_000)
  })

  // 7
  test('tahmini bitiş, beklerken gelen kesin sonucu ezmez', async ($, on) => {
    const { clock, ctl } = world(on, [], {}, [...ROUND1, DEV2])
    await launch($)
    await clock.advance(2100)
    ctl.slowMeta = true
    const stop = $.classic.Stop(STOP) // dev #2 meta'sını okurken bekler
    await clock.settle()
    ctl.slowMeta = false
    await $.prompt.submit(notify('t1', 'failed'))
    await clock.advance(400)
    await stop
    expect((await $.command.run(WF)).text).toContain('feature · hata')
  })

  // 8
  test('refresh run başına tek uçuş', async ($, on) => {
    const { clock, ctl } = world(on, [])
    await launch($)
    await clock.advance(2100)
    const n = ctl.lists
    ctl.slowList = true
    const a = $.command.run(WF)
    const b = $.command.run(WF)
    await clock.settle()
    ctl.slowList = false
    await clock.advance(400)
    await Promise.all([a, b])
    expect(ctl.lists).toBe(n + 1)
  })

  // 9
  test('meta değişince yeniden okunur; stoppedByUser journal failed\'dan önce gelir', async ($, on) => {
    const failed = { type: 'failed', key: 'k6', agentId: 'dev00002' }
    const { clock, files, posts } = world(on, [], POST_ENV, [...ROUND1, DEV2, failed])
    await launch($)
    await clock.advance(2100)
    const dev2 = () => lastPost(posts).body.runs[0].agents.find(a => a.id === 'dev00002')
    expect(dev2().status).toBe('failed')
    files['agent-dev00002.meta.json'] = JSON.stringify({ ...META.dev00002, description: 'dev #2 (durdu)', stoppedByUser: true })
    await clock.advance(2000)
    expect(dev2().status).toBe('stopped')
    expect(dev2().label).toBe('dev #2 (durdu)')
  })

  // 10
  test('fs.list boyut vermezse journal her poll\'da okunur', async ($, on) => {
    const { clock, reads, ctl } = world(on, [])
    ctl.noSize = true
    await launch($)
    await clock.advance(2100)
    await clock.advance(2000)
    await clock.advance(2000)
    expect(reads.filter(p => p.endsWith('journal.jsonl')).length).toBe(3)
  })

  // 11
  test('tahmini bitiş: journal büyürse ya da agent tool çağırırsa run yeniden çalışıyor; 60 sn sonra izleme biter', async ($, on) => {
    const { clock, files, ctl } = world(on, [])
    await launch($)
    await clock.advance(2100)
    await $.classic.Stop(STOP)
    expect((await $.command.run(WF)).text).toContain('feature · bitti')
    files['journal.jsonl'] += JSON.stringify(DEV2) + '\n'
    await clock.advance(2000)
    expect((await $.command.run(WF)).text).toContain('feature · çalışıyor')

    await $.classic.Stop(STOP)
    expect((await $.command.run(WF)).text).toContain('feature · durduruldu')
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'dev00002' })
    expect((await $.command.run(WF)).text).toContain('feature · çalışıyor')

    await $.classic.Stop(STOP)
    await clock.advance(62_000)
    const n = ctl.lists
    await clock.advance(10_000)
    expect(ctl.lists).toBe(n)
    expect((await $.command.run(WF)).text).toContain('feature · durduruldu')
  })

  test('kesin bitiş geri alınmaz', async ($, on) => {
    const { clock, files } = world(on, [])
    await launch($)
    await clock.advance(2100)
    await $.prompt.submit(notify('t1', 'completed'))
    files['journal.jsonl'] += JSON.stringify(DEV2) + '\n'
    await clock.advance(2000)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'dev00001' })
    expect((await $.command.run(WF)).text).toContain('feature · bitti')
  })

  // 12
  test('bellekte en fazla 10 bitmiş ve teslim edilmiş run kalır', async ($, on) => {
    const { clock } = world(on, [], POST_ENV)
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    for (let i = 0; i < 12; i++) {
      await $.tool.call({ tool: 'Workflow', name: 'feature', tid: 'r' + i })
      await $.prompt.submit(notify('r' + i, 'completed'))
      await clock.advance(2000)
    }
    const text = (await $.command.run(WF)).text
    expect(text.split('\n').filter(l => l.startsWith('feature · ')).length).toBe(10)
  })
})
