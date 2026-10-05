# Graph Report - claude-config  (2026-10-05)

## Corpus Check
- 32 files · ~45,621 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .webmanifest 1, .css 1)

## Summary
- 518 nodes · 1555 edges · 24 communities (19 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bc7e14ab`
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
- $
- wf · akış
- store.mjs
- login.js
- automations.js
- num
- register
- push
- finish
- clip
- cut

## God Nodes (most connected - your core abstractions)
1. `$` - 75 edges
2. `h()` - 57 edges
3. `register()` - 34 edges
4. `num()` - 31 edges
5. `fmtCost()` - 30 edges
6. `str()` - 26 edges
7. `renderCosts()` - 25 edges
8. `createServer()` - 24 edges
9. `arr()` - 23 edges
10. `renderDetail()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `closeThemes()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderBell()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `connect()` --indirect_call--> `refreshCosts()`  [INFERRED]
  dashboard/public/app.js → dashboard/public/costs.js
- `login()` --indirect_call--> `view()`  [INFERRED]
  dashboard/server.mjs → dashboard/store.mjs
- `setTheme()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js

## Import Cycles
- None detected.

## Communities (24 total, 5 thin omitted)

### Community 0 - "automations.mjs"
Cohesion: 0.05
Nodes (49): asciiTitle(), cleanAction(), cleanSettings(), cleanTrigger(), createAutomations(), deliver(), flush(), dayKey() (+41 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.22
Nodes (8): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon (yalnız kullanıcı isterse), Review (yalnız kullanıcı isterse), Çalışma, Öncelik

### Community 3 - "register.js"
Cohesion: 0.11
Nodes (23): active(), art, artItems(), delivered(), EDITS, graphUse, main, needPoll() (+15 more)

### Community 4 - "flow.test.ts"
Cohesion: 0.11
Nodes (13): DEV2, jsonl(), META, PANE, POST_ENV, QA, REVIEW, ROUND1 (+5 more)

### Community 5 - "simulate.mjs"
Cohesion: 0.13
Nodes (20): argv, BASE, between(), FAST, FIND, hex(), history(), liveSession() (+12 more)

### Community 6 - "app.js"
Cohesion: 0.07
Nodes (49): closeThemes(), connect(), openSession(), pal, palClose(), palGo(), palIn, palItems (+41 more)

### Community 7 - "live.js"
Cohesion: 0.08
Nodes (69): agentChip(), api, burn(), click(), clip(), closeDetail(), commonDir(), detailTick() (+61 more)

### Community 13 - "$"
Cohesion: 0.11
Nodes (60): renderPickers(), CLASS, api, classBars(), controls(), dailyChart(), graphImpact(), heatmap() (+52 more)

### Community 14 - "wf · akış"
Cohesion: 0.40
Nodes (4): Deploy (Coolify), Geliştirme, Görünümler, wf · akış

### Community 15 - "store.mjs"
Cohesion: 0.12
Nodes (35): CLASSES, classify(), KNOWN_TYPES, text(), ALIAS, costOf(), modelKey(), PRICES (+27 more)

### Community 16 - "login.js"
Cohesion: 0.50
Nodes (3): code, MESSAGES, THEMES

### Community 17 - "automations.js"
Cohesion: 0.23
Nodes (22): budgetPanel(), digestPanel(), field(), FORMAT_NAMES, load(), log(), meter(), numIn() (+14 more)

### Community 18 - "num"
Cohesion: 0.38
Nodes (18): applyPatch(), graph(), loadNorms(), normAgent(), normArt(), normRun(), normSummary(), normTotals() (+10 more)

### Community 19 - "register"
Cohesion: 0.20
Nodes (15): counts(), describe(), fmtTok(), hasRunning(), lastDone(), lastStep(), miscUsage(), openPane() (+7 more)

### Community 20 - "push"
Cohesion: 0.20
Nodes (12): addArtifacts(), artifactsOf(), edgesOf(), fit(), outText(), pending(), push(), roundOf() (+4 more)

### Community 21 - "finish"
Cohesion: 0.31
Nodes (11): finish(), poll(), pushSoon(), readMeta(), readRun(), reconcile(), redraw(), refresh() (+3 more)

### Community 22 - "clip"
Cohesion: 0.25
Nodes (8): addUsage(), clip(), countTool(), graphHit(), mask(), maskDeep(), phasesOf(), repoName()

### Community 23 - "cut"
Cohesion: 0.40
Nodes (6): cut(), endSub(), objs(), strs(), summarize(), touch()

## Knowledge Gaps
- **95 isolated node(s):** `TRIGGERS`, `FORMATS`, `argv`, `BASE`, `FAST` (+90 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 128 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `$` to `app.js`, `live.js`, `store.mjs`, `automations.js`, `num`?**
  _High betweenness centrality (0.296) - this node is a cross-community bridge._
- **Why does `h()` connect `$` to `automations.js`, `app.js`, `live.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `createServer()` connect `automations.mjs` to `store.mjs`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `TRIGGERS`, `FORMATS`, `argv` to the rest of the system?**
  _95 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `automations.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05403508771929825 - nodes in this community are weakly interconnected._
- **Should `register.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10869565217391304 - nodes in this community are weakly interconnected._
- **Should `flow.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._