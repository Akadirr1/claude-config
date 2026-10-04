# Graph Report - claude-config  (2026-10-04)

## Corpus Check
- 27 files · ~35,059 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .webmanifest 1, .css 1)

## Summary
- 421 nodes · 1233 edges · 16 communities (10 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e414501e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- store.mjs
- feature.js
- claude-config
- register.js
- flow.test.ts
- simulate.mjs
- app.js
- live.js
- install.sh
- state.js
- wf · akış
- login.js

## God Nodes (most connected - your core abstractions)
1. `$` - 67 edges
2. `h()` - 39 edges
3. `register()` - 33 edges
4. `num()` - 28 edges
5. `fmtCost()` - 26 edges
6. `renderCosts()` - 25 edges
7. `renderDetail()` - 21 edges
8. `str()` - 21 edges
9. `createServer()` - 20 edges
10. `history()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `setTheme()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderPickers()` --calls--> `fmtCost()`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderPickers()` --calls--> `h()`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderHeader()` --calls--> `fmtCost()`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderBell()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js

## Import Cycles
- None detected.

## Communities (16 total, 6 thin omitted)

### Community 0 - "store.mjs"
Cohesion: 0.05
Nodes (56): CLASS, CLASSES, classify(), KNOWN_TYPES, text(), ALIAS, costOf(), modelKey() (+48 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.22
Nodes (8): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon (yalnız kullanıcı isterse), Review (yalnız kullanıcı isterse), Çalışma, Öncelik

### Community 3 - "register.js"
Cohesion: 0.07
Nodes (69): active(), addUsage(), clip(), counts(), countTool(), cut(), delivered(), describe() (+61 more)

### Community 4 - "flow.test.ts"
Cohesion: 0.11
Nodes (13): DEV2, jsonl(), META, PANE, POST_ENV, QA, REVIEW, ROUND1 (+5 more)

### Community 5 - "simulate.mjs"
Cohesion: 0.14
Nodes (20): argv, BASE, between(), FAST, FIND, hex(), history(), liveSession() (+12 more)

### Community 6 - "app.js"
Cohesion: 0.07
Nodes (58): connect(), openSession(), pal, palClose(), palGo(), palIn, palItems, palList (+50 more)

### Community 7 - "live.js"
Cohesion: 0.10
Nodes (58): api, burn(), click(), clip(), closeDetail(), detailTick(), drawEdges(), endOf() (+50 more)

### Community 13 - "state.js"
Cohesion: 0.14
Nodes (54): api, classBars(), controls(), dailyChart(), graphImpact(), heatmap(), kpi(), legend() (+46 more)

### Community 14 - "wf · akış"
Cohesion: 0.40
Nodes (4): Deploy (Coolify), Geliştirme, Görünümler, wf · akış

## Knowledge Gaps
- **80 isolated node(s):** `argv`, `BASE`, `FAST`, `PHASES`, `SPEC` (+75 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 106 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `app.js` to `store.mjs`, `state.js`, `live.js`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `h()` connect `state.js` to `app.js`, `live.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `argv`, `BASE`, `FAST` to the rest of the system?**
  _80 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `store.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05290490100616683 - nodes in this community are weakly interconnected._
- **Should `register.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07039337474120083 - nodes in this community are weakly interconnected._
- **Should `flow.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `simulate.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.13902439024390245 - nodes in this community are weakly interconnected._