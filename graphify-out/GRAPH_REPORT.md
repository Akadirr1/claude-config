# Graph Report - claude-config  (2026-10-04)

## Corpus Check
- 12 files · ~4,798 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 1 file(s) not represented in the graph (top: (none) 1)

## Summary
- 63 nodes · 92 edges · 13 communities (8 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1b6438f7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.mjs
- feature.js
- claude-config
- register
- flow.test.ts
- register.js
- poll
- push
- install.sh

## God Nodes (most connected - your core abstractions)
1. `register()` - 16 edges
2. `finish()` - 8 edges
3. `push()` - 7 edges
4. `claude-config` - 7 edges
5. `server` - 6 edges
6. `summaryText()` - 5 edges
7. `refresh()` - 5 edges
8. `poll()` - 5 edges
9. `viewer()` - 4 edges
10. `since()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `register()` --calls--> `short()`  [EXTRACTED]
  mods/wf-monitor/hooks/register.js → mods/wf-monitor/hooks/register.js  _Bridges community 5 → community 3_
- `summaryText()` --calls--> `since()`  [EXTRACTED]
  mods/wf-monitor/hooks/register.js → mods/wf-monitor/hooks/register.js  _Bridges community 3 → community 7_
- `finish()` --calls--> `redraw()`  [EXTRACTED]
  mods/wf-monitor/hooks/register.js → mods/wf-monitor/hooks/register.js  _Bridges community 6 → community 3_
- `poll()` --calls--> `push()`  [EXTRACTED]
  mods/wf-monitor/hooks/register.js → mods/wf-monitor/hooks/register.js  _Bridges community 7 → community 6_

## Import Cycles
- None detected.

## Communities (13 total, 5 thin omitted)

### Community 0 - "server.mjs"
Cohesion: 0.26
Nodes (10): broadcast(), clients, cookieToken(), PORT, readBody(), same(), server, sessions (+2 more)

### Community 1 - "feature.js"
Cohesion: 0.18
Nodes (8): input, list, MAX_ROUNDS, meta, QA, REVIEW, SPEC, task

### Community 2 - "claude-config"
Cohesion: 0.25
Nodes (7): Archify, claude-config, Commit ve PR, Graphify, Orkestrasyon, Review, Çalışma

### Community 3 - "register"
Cohesion: 0.43
Nodes (7): finish(), hasRunning(), openPane(), phasesOf(), reconcile(), register(), since()

### Community 4 - "flow.test.ts"
Cohesion: 0.33
Nodes (3): PANE, textOf(), WF

### Community 5 - "register.js"
Cohesion: 0.50
Nodes (4): describe(), lastAction, runs, short()

### Community 6 - "poll"
Cohesion: 0.50
Nodes (4): poll(), redraw(), refresh(), startPolling()

### Community 7 - "push"
Cohesion: 1.00
Nodes (3): push(), summaryText(), view()

## Knowledge Gaps
- **22 isolated node(s):** `PORT`, `sessions`, `clients`, `install.sh script`, `runs` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 34 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `register()` connect `register` to `register.js`, `poll`, `push`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `finish()` connect `register` to `register.js`, `poll`, `push`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `PORT`, `sessions`, `clients` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._