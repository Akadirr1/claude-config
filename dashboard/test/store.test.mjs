import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../public/classes.js'
import { costOf, modelKey } from '../public/pricing.js'
import { stats, merge, view, summary, bloatOf, runsOf } from '../store.mjs'

test('sınıflandırma: Claude\'un serbest label/tipleri genel sınıflara oturur', () => {
  const cases = [
    [{ label: 'ba' }, 'ba'],
    [{ label: 'dev #2', phase: 'Geliştirme' }, 'dev'],
    [{ label: 'code-review #1', agentType: 'reviewer-high' }, 'review'],
    [{ label: 'qa #1', phase: 'QA' }, 'qa'],
    [{ label: 'Map auth flow', agentType: 'Explore' }, 'explore'],
    [{ label: 'scan routes for dead handlers' }, 'explore'],
    [{ label: 'Plan the migration', agentType: 'Plan' }, 'ba'],
    [{ label: 'implement-login', agentType: 'general-purpose' }, 'dev'],
    [{ label: 'verify fix reproduces' }, 'qa'],
    [{ label: 'refute: race in cache', phase: 'Verify' }, 'review'],
    [{ label: 'write README section' }, 'docs'],
    [{ label: 'dashboard palette mockup' }, 'design'],
    [{ label: 'coolify deploy check', phase: 'Ops' }, 'ops'],
    [{ label: 'xyz', hint: 'Find every caller of fetchUser and list them' }, 'explore'],
    [{ label: 'xyz' }, 'other'],
    [{ main: true, label: 'dev' }, 'orchestrator'],
    [{ label: { toString: 1 }, agentType: ['x'] }, 'other'],
  ]
  for (const [a, cls] of cases) assert.equal(classify(a), cls, JSON.stringify(a))
})

test('fiyat: model kimlikleri normalize edilir, maliyet doğru', () => {
  assert.equal(modelKey('claude-opus-5-5[1m]'), 'claude-opus-5-5')
  assert.equal(modelKey('us.anthropic.claude-sonnet-4-5-20250929-v1:0'), 'claude-sonnet-4-5')
  assert.equal(modelKey('claude-opus-4-5-20251101'), 'claude-opus-4-5')
  assert.equal(modelKey('haiku'), 'claude-haiku-4-5')
  assert.equal(modelKey('gpt-x'), null)
  assert.equal(costOf('claude-fable-5-1', { in: 1e6, out: 1e6, cr: 1e6, cw: 1e6 }), 10 + 50 + 0.25 + 12.5)
  assert.equal(costOf('bilinmeyen', { in: 1e6 }), 0)
})

test('analiz: gün sınırı saat dilimine göre, tümü aralığı ilk kayda kadar uzanır', () => {
  const now = Date.parse('2026-10-04T22:30:00Z') // TR saatiyle 5 Ekim 01:30
  const row = (start, cost) => ({ sid: 's', repo: 'r', kind: 'sub', cls: 'dev', model: 'm', start, end: start, in: 0, out: 0, cr: 0, cw: 0, n: 0, cost, g: 0, r: 0 })
  const st = stats([row(now, 1), row(now - 3 * 86400e3, 2)], { days: 0, now, tz: 180 })
  assert.equal(st.byDay.at(-1).day, '2026-10-05')
  assert.equal(st.byDay.at(-1).cost, 1)
  assert.equal(st.byDay.length, 4)
  assert.equal(st.totals.cost, 3)
  assert.equal(st.heat.length, 84)
})

test('sınıflandırma: belirsiz etiketlerde doküman ağır basar', () => {
  assert.equal(classify({ label: 'Write deploy notes for volume', hint: 'Write a short README section about the /app/data volume' }), 'docs')
})

test('eserler: epoch\'lar arası birleşir, PR yalnız github pull bağlantısı, commit sha doğrulanır', () => {
  const b = (epoch, art) => ({ v: 3, session: { id: 'a1', repo: 'o/r' }, epoch, sentAt: epoch, runs: [], subs: [], art })
  let rec = merge(null, b(1, { files: [{ p: '/w/a.js', n: 2, t: 5, by: ['main'] }], commits: [{ sha: 'abc1234', msg: 'x', t: 6, by: 'main' }, { sha: 'zz;rm', msg: 'y' }], prs: [{ url: 'javascript:alert(1)' }, { url: 'https://github.com/o/r/pull/3', t: 7, by: 'd1' }] }), 1)
  rec = merge(rec, b(2, { files: [{ p: '/w/a.js', n: 1, t: 9, by: ['d1'] }], commits: [], prs: [] }), 2)
  const v = view(rec)
  assert.deepEqual(v.art.files, [{ p: '/w/a.js', n: 2, t: 9, by: ['main', 'd1'] }])
  assert.deepEqual(v.art.commits.map(c => c.sha), ['abc1234'])
  assert.deepEqual(v.art.prs.map(x => x.url), ['https://github.com/o/r/pull/3'])
  assert.deepEqual(summary(v).art, { files: 1, commits: 1, prs: ['https://github.com/o/r/pull/3'] })
})

test('bağlam şişmesi: önceki çıkış düşülür, artış aradaki araçlara bölünür', () => {
  const b = bloatOf([{ c: 1000, o: 200, x: [] }, { c: 41200, o: 50, x: ['Read: big.js', 'Grep: x'] }, { c: 41300, o: 10, x: ['Bash: ls'] }, { c: 40000, o: 0, x: ['Read: y'] }, 'çöp', { c: 'x' }])
  assert.equal(b.peak, 41300)
  assert.deepEqual(b.jumps[0], { d: 40000, x: 'Read: big.js · Grep: x' })
  assert.deepEqual(b.byTool, { Read: 20000, Grep: 20000, Bash: 50 })
  assert.deepEqual(bloatOf(undefined), { peak: 0, jumps: [], byTool: {} })
})

test('token analizi: cache israfı, sınıf bazında graf karnesi, şişiren araçlar, run karşılaştırma', () => {
  const now = Date.UTC(2026, 9, 5, 12)
  const r = (id, extra) => ({ sid: 's', repo: 'o/r', kind: 'wf', run: 'feature', runId: 't1', phase: 'Geliştirme', round: 1, id, label: id, cls: 'dev', status: 'done', start: now - 3600e3, end: now, in: 1000, out: 100, cr: 0, cw: 0, n: 1, cost: 0.1, g: 0, r: 2, peak: 5000, jumps: [], bt: {}, ...extra })
  const rs = [
    r('a', { cw: 50000, cr: 1000, bt: { Read: 30000 }, jumps: [{ d: 30000, x: 'Read: big.js' }] }),
    r('b', { g: 3, in: 400, cr: 9000, peak: 3000 }),
    r('c', { runId: 't2', start: now - 600e3, in: 2000 }),
  ]
  const st = stats(rs, { days: 7, now })
  assert.deepEqual(st.cacheWaste.map(x => x.id), ['a'])
  assert.equal(st.bloat.byTool[0].tool, 'Read')
  assert.equal(st.bloat.jumps[0].label, 'a')
  const dev = st.graphify.byClass.find(x => x.cls === 'dev')
  assert.equal(dev.with.n, 1)
  assert.equal(dev.without.n, 2)
  assert.equal(st.topTok[0].id, 'a')
  assert.ok(st.byDay.at(-1).byClassTok.dev > 0)
  const runs = runsOf(rs, 'feature')
  assert.deepEqual(runs.map(x => x.runId), ['t2', 't1'])
  assert.equal(runs[1].agents.length, 2)
  assert.equal(runs[1].agents[0].phase, 'Geliştirme')
})
