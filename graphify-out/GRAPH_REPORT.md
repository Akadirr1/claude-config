# Graph Report - claude-config  (2026-10-05)

## Corpus Check
- 33 files · ~52,984 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .webmanifest 1, .css 1)

## Summary
- 565 nodes · 1804 edges · 24 communities (18 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `67fe6814`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- automations.mjs
- feature.js
- claude-config
- register.js
- flow.test.ts
- simulate.mjs
- app.js
- live.js
- install.sh
- poll
- wf · akış
- store.mjs
- login.js
- automations.js
- $
- register
- push
- finish
- clip

## God Nodes (most connected - your core abstractions)
1. `$` - 87 edges
2. `h()` - 67 edges
3. `register()` - 39 edges
4. `num()` - 38 edges
5. `renderCosts()` - 34 edges
6. `str()` - 32 edges
7. `fmtTok()` - 32 edges
8. `arr()` - 30 edges
9. `fmtCost()` - 25 edges
10. `createServer()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `closeThemes()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderBell()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `connect()` --indirect_call--> `refreshCosts()`  [INFERRED]
  dashboard/public/app.js → dashboard/public/costs.js
- `createServer()` --calls--> `spend()`  [EXTRACTED]
  dashboard/server.mjs → dashboard/automations.mjs
- `api()` --calls--> `spend()`  [EXTRACTED]
  dashboard/server.mjs → dashboard/automations.mjs

## Import Cycles
- None detected.

## Communities (24 total, 6 thin omitted)

### Community 0 - "automations.mjs"
Cohesion: 0.07
Nodes (27): asciiTitle(), cleanAction(), cleanSettings(), cleanTrigger(), createAutomations(), deliver(), flush(), dayKey() (+19 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.22
Nodes (8): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon (yalnız kullanıcı isterse), Review (yalnız kullanıcı isterse), Çalışma, Öncelik

### Community 3 - "register.js"
Cohesion: 0.09
Nodes (24): art, between, countTool(), ctxAgg, EDITS, GRAPH_HINT, graphHit(), graphUse (+16 more)

### Community 4 - "flow.test.ts"
Cohesion: 0.11
Nodes (14): withGraphHint(), DEV2, jsonl(), META, PANE, POST_ENV, QA, REVIEW (+6 more)

### Community 5 - "simulate.mjs"
Cohesion: 0.14
Nodes (20): argv, BASE, between(), FAST, FIND, hex(), history(), liveSession() (+12 more)

### Community 6 - "app.js"
Cohesion: 0.06
Nodes (83): closeThemes(), connect(), openSession(), pal, palClose(), palGo(), palIn, palItems (+75 more)

### Community 7 - "live.js"
Cohesion: 0.08
Nodes (65): agentChip(), api, baseOf(), click(), clip(), closeDetail(), commonDir(), contextCurve() (+57 more)

### Community 13 - "poll"
Cohesion: 0.36
Nodes (8): active(), artItems(), delivered(), needPoll(), poll(), prune(), rechecking(), undelivered()

### Community 14 - "wf · akış"
Cohesion: 0.40
Nodes (4): Deploy (Coolify), Geliştirme, Görünümler, wf · akış

### Community 15 - "store.mjs"
Cohesion: 0.07
Nodes (62): CLASS, CLASSES, classify(), KNOWN_TYPES, text(), ALIAS, costOf(), modelKey() (+54 more)

### Community 16 - "login.js"
Cohesion: 0.50
Nodes (3): code, MESSAGES, THEMES

### Community 17 - "automations.js"
Cohesion: 0.23
Nodes (22): budgetPanel(), digestPanel(), field(), FORMAT_NAMES, load(), log(), meter(), numIn() (+14 more)

### Community 18 - "$"
Cohesion: 0.10
Nodes (79): renderHeader(), renderPickers(), agentCell(), api, bloatView(), byUnit(), cacheWaste(), classBars() (+71 more)

### Community 19 - "register"
Cohesion: 0.18
Nodes (16): addPoint(), counts(), describe(), fmtTok(), hasRunning(), lastDone(), lastStep(), miscUsage() (+8 more)

### Community 20 - "push"
Cohesion: 0.21
Nodes (13): addArtifacts(), artifactsOf(), ctxOf(), edgesOf(), fit(), outText(), pending(), push() (+5 more)

### Community 21 - "finish"
Cohesion: 0.21
Nodes (13): endSub(), finish(), pushSoon(), readMeta(), readRun(), reconcile(), redraw(), refresh() (+5 more)

### Community 22 - "clip"
Cohesion: 0.24
Nodes (10): addUsage(), clip(), cut(), mask(), maskDeep(), objs(), phasesOf(), repoName() (+2 more)

## Knowledge Gaps
- **100 isolated node(s):** `TRIGGERS`, `FORMATS`, `argv`, `BASE`, `FAST` (+95 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 134 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `$` to `automations.js`, `store.mjs`, `app.js`, `live.js`?**
  _High betweenness centrality (0.294) - this node is a cross-community bridge._
- **Why does `h()` connect `$` to `automations.js`, `app.js`, `live.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `createServer()` connect `store.mjs` to `automations.mjs`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `TRIGGERS`, `FORMATS`, `argv` to the rest of the system?**
  _100 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `automations.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07013574660633484 - nodes in this community are weakly interconnected._
- **Should `register.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `flow.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._