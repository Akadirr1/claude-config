# Graph Report - claude-config  (2026-10-05)

## Corpus Check
- 32 files · ~49,716 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 2, .webmanifest 1, .css 1)

## Summary
- 549 nodes · 1749 edges · 23 communities (18 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fa91dcd1`
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
- costs.js
- wf · akış
- store.mjs
- login.js
- automations.js
- register
- push
- finish
- clip
- artifactsOf

## God Nodes (most connected - your core abstractions)
1. `$` - 86 edges
2. `h()` - 65 edges
3. `num()` - 36 edges
4. `register()` - 35 edges
5. `renderCosts()` - 32 edges
6. `str()` - 31 edges
7. `fmtTok()` - 30 edges
8. `arr()` - 28 edges
9. `fmtCost()` - 26 edges
10. `createServer()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `closeThemes()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `renderBell()` --calls--> `$`  [EXTRACTED]
  dashboard/public/app.js → dashboard/public/util.js
- `createServer()` --calls--> `spend()`  [EXTRACTED]
  dashboard/server.mjs → dashboard/automations.mjs
- `api()` --calls--> `spend()`  [EXTRACTED]
  dashboard/server.mjs → dashboard/automations.mjs
- `createServer()` --calls--> `createAutomations()`  [EXTRACTED]
  dashboard/server.mjs → dashboard/automations.mjs

## Import Cycles
- None detected.

## Communities (23 total, 5 thin omitted)

### Community 0 - "automations.mjs"
Cohesion: 0.11
Nodes (26): asciiTitle(), cleanAction(), cleanSettings(), cleanTrigger(), createAutomations(), deliver(), flush(), dayKey() (+18 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.22
Nodes (8): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon (yalnız kullanıcı isterse), Review (yalnız kullanıcı isterse), Çalışma, Öncelik

### Community 3 - "register.js"
Cohesion: 0.09
Nodes (28): active(), art, artItems(), between, delivered(), EDITS, graphUse, main (+20 more)

### Community 4 - "flow.test.ts"
Cohesion: 0.11
Nodes (13): DEV2, jsonl(), META, PANE, POST_ENV, QA, REVIEW, ROUND1 (+5 more)

### Community 5 - "simulate.mjs"
Cohesion: 0.13
Nodes (20): argv, BASE, between(), FAST, FIND, hex(), history(), liveSession() (+12 more)

### Community 6 - "app.js"
Cohesion: 0.07
Nodes (50): closeThemes(), openSession(), pal, palClose(), palGo(), palIn, palItems, palList (+42 more)

### Community 7 - "live.js"
Cohesion: 0.07
Nodes (105): renderHeader(), renderPickers(), heatmap(), api, dominant(), renderEvren(), rng(), st (+97 more)

### Community 13 - "costs.js"
Cohesion: 0.10
Nodes (66): connect(), agentCell(), api, bloatView(), byUnit(), cacheWaste(), classBars(), controls() (+58 more)

### Community 14 - "wf · akış"
Cohesion: 0.40
Nodes (4): Deploy (Coolify), Geliştirme, Görünümler, wf · akış

### Community 15 - "store.mjs"
Cohesion: 0.06
Nodes (61): CLASS, CLASSES, classify(), KNOWN_TYPES, text(), ALIAS, costOf(), modelKey() (+53 more)

### Community 16 - "login.js"
Cohesion: 0.50
Nodes (3): code, MESSAGES, THEMES

### Community 17 - "automations.js"
Cohesion: 0.23
Nodes (22): budgetPanel(), digestPanel(), field(), FORMAT_NAMES, load(), log(), meter(), numIn() (+14 more)

### Community 19 - "register"
Cohesion: 0.23
Nodes (14): counts(), countTool(), describe(), fmtTok(), graphHit(), hasRunning(), lastDone(), lastStep() (+6 more)

### Community 20 - "push"
Cohesion: 0.22
Nodes (10): addPoint(), edgesOf(), fit(), pending(), push(), roundOf(), statusOf(), view() (+2 more)

### Community 21 - "finish"
Cohesion: 0.31
Nodes (11): finish(), poll(), pushSoon(), readMeta(), readRun(), reconcile(), redraw(), refresh() (+3 more)

### Community 22 - "clip"
Cohesion: 0.24
Nodes (10): addUsage(), clip(), cut(), mask(), maskDeep(), objs(), phasesOf(), repoName() (+2 more)

### Community 23 - "artifactsOf"
Cohesion: 0.40
Nodes (5): addArtifacts(), artifactsOf(), endSub(), outText(), touch()

## Knowledge Gaps
- **98 isolated node(s):** `TRIGGERS`, `FORMATS`, `argv`, `BASE`, `FAST` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 131 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `live.js` to `automations.js`, `costs.js`, `app.js`, `store.mjs`?**
  _High betweenness centrality (0.301) - this node is a cross-community bridge._
- **Why does `h()` connect `live.js` to `automations.js`, `costs.js`, `app.js`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `createServer()` connect `store.mjs` to `automations.mjs`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `TRIGGERS`, `FORMATS`, `argv` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `automations.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10510510510510511 - nodes in this community are weakly interconnected._
- **Should `register.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09113300492610837 - nodes in this community are weakly interconnected._
- **Should `flow.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._