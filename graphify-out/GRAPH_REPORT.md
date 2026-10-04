# Graph Report - claude-config  (2026-10-04)

## Corpus Check
- 17 files · ~18,123 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .css 1)

## Summary
- 219 nodes · 450 edges · 17 communities (11 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c530f174`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- createServer
- feature.js
- claude-config
- register.js
- flow.test.ts
- simulate.mjs
- app.js
- h
- install.sh
- nodeEl
- renderGraph
- normRun
- login.js

## God Nodes (most connected - your core abstractions)
1. `register()` - 26 edges
2. `createServer()` - 16 edges
3. `h()` - 13 edges
4. `render()` - 13 edges
5. `renderDetail()` - 12 edges
6. `connect()` - 11 edges
7. `push()` - 11 edges
8. `view()` - 10 edges
9. `Run` - 9 edges
10. `renderGraph()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `login()` --indirect_call--> `view()`  [INFERRED]
  dashboard/server.mjs → mods/wf-monitor/hooks/register.js
- `start()` --calls--> `createServer()`  [EXTRACTED]
  dashboard/test/server.test.mjs → dashboard/server.mjs
- `start()` --calls--> `login()`  [EXTRACTED]
  dashboard/test/server.test.mjs → dashboard/server.mjs

## Import Cycles
- None detected.

## Communities (17 total, 6 thin omitted)

### Community 0 - "createServer"
Cohesion: 0.10
Nodes (20): createServer(), authed(), events(), fail(), lockedFor(), login(), push(), redirect() (+12 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.22
Nodes (8): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon (yalnız kullanıcı isterse), Review (yalnız kullanıcı isterse), Çalışma, Öncelik

### Community 3 - "register.js"
Cohesion: 0.11
Nodes (47): clip(), counts(), cut(), describe(), edgesOf(), finish(), fit(), hasRunning() (+39 more)

### Community 4 - "flow.test.ts"
Cohesion: 0.12
Nodes (13): DEV2, jsonl(), META, PANE, POST_ENV, QA, REVIEW, ROUND1 (+5 more)

### Community 5 - "simulate.mjs"
Cohesion: 0.18
Nodes (15): argv, BASE, beat(), clock, FAST, hex(), PHASE_OF, PHASES (+7 more)

### Community 6 - "app.js"
Cohesion: 0.14
Nodes (19): connect(), dropSession(), FILTERS, fmtAgo(), fmtShort(), narrow, newest(), parse() (+11 more)

### Community 7 - "h"
Cohesion: 0.25
Nodes (15): closeDetail(), current(), filterBtns, fmtClock(), h(), listOf(), openDetail(), render() (+7 more)

### Community 13 - "nodeEl"
Cohesion: 0.29
Nodes (10): agentEnd(), detailTick(), fmtDur(), fmtOff(), modNow(), nodeEl(), pad(), renderGantt() (+2 more)

### Community 14 - "renderGraph"
Cohesion: 0.24
Nodes (10): attrs(), bucket(), drawEdges(), glyph(), lastStepT(), logDiff(), motion(), renderGraph() (+2 more)

### Community 15 - "normRun"
Cohesion: 0.33
Nodes (9): arr(), each(), ingest(), normRun(), normSession(), num(), roleKey(), stKey() (+1 more)

## Knowledge Gaps
- **49 isolated node(s):** `argv`, `BASE`, `FAST`, `PHASES`, `PHASE_OF` (+44 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 69 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `view()` connect `register.js` to `createServer`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `login()` connect `createServer` to `register.js`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `renderDetail()` (e.g. with `closeDetail()` and `detailTick()`) actually correct?**
  _`renderDetail()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `argv`, `BASE`, `FAST` to the rest of the system?**
  _49 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `createServer` be split into smaller, more focused modules?**
  _Cohesion score 0.09747899159663866 - nodes in this community are weakly interconnected._
- **Should `register.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11081560283687943 - nodes in this community are weakly interconnected._
- **Should `flow.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._