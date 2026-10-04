import { describe, expect, mock, test } from 'claude-code/testing'

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

function textOf(t) {
  if (typeof t === 'string' || typeof t === 'number') return String(t)
  if (Array.isArray(t)) return t.map(textOf).join('\n')
  if (!t || typeof t !== 'object') return ''
  return textOf(t.children ?? t.props?.children ?? [])
}

function world(on, surfaces, env = {}) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, env)
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.repo', () => ({ value: { root: '/w/claude-config', remote: 'https://github.com/Akadirr1/claude-config' } }))
  on('session.start', ($, e) => e)
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.read', ($, e) => ({ value: String(e.path ?? e).endsWith('journal.jsonl') ? '{"label":"ba"}\n' : SCRIPT }))
  on('fs.list', () => ({
    value: [
      { name: 'agent-abc12345zz.jsonl', kind: 'file', size: 10, isLink: false },
      { name: 'journal.jsonl', kind: 'file', size: 10, isLink: false },
    ],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: clock.now(), isLink: false } }))
  on('tool.call', { tool: 'Workflow' }, () => ({
    result: { status: 'async_launched', taskId: 't1', workflowName: 'feature', transcriptDir: DIR, scriptPath: DIR + '/script.js' },
  }))
  return clock
}

describe('wf-monitor', () => {
  test('workflow yokken /wf bunu söyler', async ($, on) => {
    world(on, [])
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    expect(await $.command.run(WF)).toEqual({ text: "Bu session'da workflow çalışmadı." })
  })

  test('başlayan run pane ve /wf metninde görünür', async ($, on) => {
    const clock = world(on, ['terminal'])
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Workflow', name: 'feature' })
    await clock.advance(2100)
    const drawn = textOf(await $.ui.render(PANE))
    expect(drawn).toContain('feature · running')
    expect(drawn).toContain('başlayan 1  aktif 1  biten 1')
    expect(drawn).toContain('Analiz → Geliştirme → Review → QA')
    expect(drawn).toContain('son dönen: ba')
    const text = (await $.command.run(WF)).text
    expect(text).toContain('başlayan 1 / aktif 1 / biten 1')
  })
  test('agent son adımı görünür, Stop listesinde yoksa run biter', async ($, on) => {
    const clock = world(on, ['terminal'])
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
    on('classic.Stop', ($, e) => ({}))
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Workflow', name: 'feature' })
    await $.tool.call({ tool: 'Bash', command: 'npm test -- --run', agentId: 'abc12345zz' })
    await clock.advance(2100)
    expect(textOf(await $.ui.render(PANE))).toContain('abc12345 Bash: npm test -- --run')
    await $.classic.Stop({ hook_event_name: 'Stop', session_id: 's', transcript_path: '/t', cwd: '/w', stop_hook_active: false, background_tasks: [] })
    expect((await $.command.run(WF)).text).toContain('feature · bitti')
  })
  test('URL ve token varsa durumu dashboard\'a POST eder', async ($, on) => {
    const posts = []
    const clock = world(on, [], { WF_MONITOR_URL: 'https://wf.example/api/push', WF_MONITOR_TOKEN: 'sir' })
    on('http.fetch', ($, e) => {
      posts.push(e)
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    })
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Workflow', name: 'feature' })
    await clock.advance(2100)
    expect(posts.length > 0).toBe(true)
    const last = posts[posts.length - 1]
    const [url, init] = Array.isArray(last) ? last : [last.url, last.init]
    expect(url).toBe('https://wf.example/api/push')
    expect(init.headers.Authorization).toBe('Bearer sir')
    const body = JSON.parse(init.body)
    expect(body.session).toEqual({ id: 'sess-1', repo: 'Akadirr1/claude-config' })
    expect(body.runs[0].name).toBe('feature')
    expect(body.runs[0].agents[0]).toEqual({ id: 'abc12345', active: true, last: null })
  })
})
