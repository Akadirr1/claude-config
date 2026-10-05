import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../public/classes.js'
import { costOf, modelKey } from '../public/pricing.js'
import { stats, merge, view, summary, bloatOf, runsOf, rows } from '../store.mjs'

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
  assert.deepEqual({ ...b.byTool }, { Read: 20000, Grep: 20000, Bash: 50 })
  const e = bloatOf(undefined)
  assert.deepEqual([e.peak, e.jumps, { ...e.byTool }], [0, [], {}])
})

test('bağlam şişmesi: mod özeti öncelikli, inceltme boşluğu sıçrama değil, "constructor" adı ve dev seri güvenli', () => {
  const fromCtx = bloatOf([{ c: 10, o: 0, x: [] }], { peak: 9e9, byTool: { Read: 300, constructor: 5 }, jumps: [{ d: 300, x: 'Read: a' }, 'çöp'] })
  assert.equal(fromCtx.peak, 1e9, 'sayılar sınırlı')
  assert.equal(fromCtx.byTool.constructor, 5)
  assert.equal(fromCtx.jumps.length, 1)
  const gap = bloatOf([{ i: 1, c: 100, o: 0, x: [] }, { i: 90, c: 90000, o: 0, x: ['Read: f'] }, { i: 91, c: 91000, o: 0, x: ['Grep: g'] }])
  assert.deepEqual(gap.jumps, [{ d: 1000, x: 'Grep: g' }])
  const viaSeries = bloatOf([{ c: 1, o: 0, x: [] }, { c: 6, o: 0, x: ['constructor: x'] }])
  assert.equal(viaSeries.byTool.constructor, 5)
  const huge = Array.from({ length: 5000 }, (_, i) => ({ i: i + 1, c: i * 10, o: 0, x: [`T${i}: x`] }))
  assert.equal(Object.keys(bloatOf(huge).byTool).length, 20)
})

test('merge: seri ve ctx push\'ta sınırlanır', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => ({ i: i + 1, c: i, o: 1e308, x: ['y'.repeat(500), 2, 'a', 'b', 'c', 'd'] }))
  const rec = merge(null, { v: 3, session: { id: 'z', repo: 'o/r' }, epoch: 1, sentAt: 1, runs: [], subs: [{ id: 's1', series: huge, ctx: { peak: 'x', byTool: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`t${i}`, i + 1])), jumps: [{ d: 1, x: 'z'.repeat(999) }] } }] }, 1)
  const sub = rec.subs.s1
  assert.equal(sub.series.length, 200)
  assert.equal(sub.series[0].o, 1e9)
  assert.deepEqual(sub.series[0].x.map(x => x.length), [80, 1, 1, 1])
  assert.equal(Object.keys(sub.ctx.byTool).length, 20)
  assert.equal(sub.ctx.jumps[0].x.length, 300)
  assert.equal(sub.ctx.peak, 0)
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

test('deneyler: etiketli session\'lar etiket başına ortancalanır; taban ve etiket satırda', () => {
  const now = Date.UTC(2026, 9, 5, 12)
  const r = (sid, tag, kind, extra) => ({ sid, repo: 'o/r', tag, kind, id: kind === 'main' ? 'main' : sid + 'x', label: 'a', cls: 'dev', status: 'done', start: now - 60e3, end: now, in: 0, out: 100, cr: 1000, cw: 100, n: 2, cost: 0, g: 0, r: 0, peak: 1000, base: 500, jumps: [], bt: {}, ...extra })
  const rs = [
    r('a', 'grafli', 'main', { cr: 5000, g: 2 }), r('a', 'grafli', 'sub', { g: 1 }),
    r('b', 'grafsiz', 'main', { cr: 9000, r: 3 }), r('b', 'grafsiz', 'sub', { r: 2 }),
    r('c', '', 'main', {}),
  ]
  const ex = stats(rs, { days: 7, now }).experiments
  assert.deepEqual(ex.map(x => [x.tag, x.sessions]), [['grafli', 1], ['grafsiz', 1]])
  assert.equal(ex[0].tok, 5200 + 1200)
  assert.equal(ex[0].graph, 1)
  assert.equal(ex[1].graph, 0)
  assert.ok(ex[1].mainShare > 0.8)
  const rec = merge(null, { v: 3, session: { id: 't', repo: 'o/r', tag: 'grafsiz' }, epoch: 1, sentAt: 1, runs: [], subs: [{ id: 's', ctx: { base: 42000, peak: 50000 } }] }, 1)
  assert.equal(rec.tag, 'grafsiz')
  const rw = rows(view(rec))
  assert.equal(rw.find(x => x.id === 's').base, 42000)
  assert.equal(rw[0].tag, 'grafsiz')
  assert.equal(merge(null, { v: 3, session: { id: 'u', repo: 'o/r', tag: '<script>' }, runs: [] }, 1).tag, undefined)
})
