---
name: import-graph
description: Static import analysis that builds dependency graphs, domain clusters, hub files, git churn hotspots, and file priority rankings
triggers:
  files:
    - src/lib/graph-builder.js
    - src/lib/graph-persistence.js
    - src/lib/parsers/**
    - src/commands/doc-graph.js
    - src/templates/hooks/graph-context-prompt.mjs
  keywords:
    - graph
    - import-graph
    - hubs
    - clusters
    - hotspots
    - code-map
    - graph.json
    - subgraph
    - priority
    - fanIn
---

You are working on the **import graph system** — static analysis that parses JS/TS and Python source files to produce dependency graphs, plus persistence/query layers for runtime use.

## Domain purpose
The graph turns raw source into a queryable map of "what depends on what" so other aspens features (doc-init, doc-sync, doc-impact, the graph context hook) can rank files by importance, surface hubs, detect domain clusters, and inject just the relevant neighborhood into prompts. It is the substrate that makes context generation deterministic and code-aware rather than guess-based.

## Key Concepts
**graph-builder.js** — `buildRepoGraph(repoPath, languages?)` runs a 9-step pipeline:
1. Walk source files → 2. Parse imports → 3. Reverse edges → 4. Git churn → 5. Per-file metrics → 6. Priority ranking → 7. Hub detection → 8. Domain clustering → 9. Hotspots

**graph-persistence.js** — Persistence and query layer:
- `serializeGraph()` converts raw graph to indexed format (O(1) lookups, file→cluster mapping)
- `persistGraphArtifacts(repoPath, rawGraph, options?)` writes `.claude/graph.json` + `.claude/code-map.md` + `.claude/graph-index.json` + auto-gitignores them. **Target-aware:** if `options.target.supportsGraph === false`, returns serialized data without writing files.
- `extractSubgraph(graph, filePaths)` returns 1-hop neighborhood of mentioned files + relevant hubs/hotspots/clusters
- `formatNavigationContext(subgraph)` renders compact markdown (~50 line budget) for prompt injection
- `extractFileReferences(prompt, graph)` tiered extraction: explicit paths → bare filenames → cluster keywords
- `generateCodeMap()` / `writeCodeMap()` standalone overview for graph hook consumption — emits a Domain clusters block (via `formatDomainClusters`) and framework entry points only; cross-domain coupling, hotspots, and the totals/date footer are intentionally omitted because they churn on every sync
- `formatDomainClusters(clusters, files)` — exported helper that renders the canonical Domain clusters block: clusters are merged by label, single-file clusters dropped, files per cluster capped at 5 and sorted by `fanIn` desc then path asc for sync stability; no per-cluster `(N files)` counts
- `generateGraphIndex()` / `saveGraphIndex()` tiny inverted index (export names → files, hub basenames, cluster labels)

**doc-graph.js** — Target-aware: reads `.aspens.json` config, passes target to `persistGraphArtifacts()`. Shows different completion message for Codex target (artifacts not written).

## Critical Rules
- **`await init` before any `parseJsImports` call.** es-module-lexer requires WASM initialization.
- **Priority formula is load-bearing:** `fanIn * 3.0 + exportCount * 1.5 + (isEntry ? 10.0 : 0) + churn * 2.0 + (1/(depth+1)) * 1.0`. Downstream consumers depend on this ranking.
- **All paths are repo-relative strings**, never absolute. Resolution functions convert abs→relative.
- **Graph artifacts are gitignored** — `ensureGraphGitignore()` (internal to persistence) adds `.claude/graph.json`, `.claude/graph-index.json`, `.claude/code-map.md` to prevent commit loops.
- **Graph artifacts are Claude-only** — when target has `supportsGraph: false`, `persistGraphArtifacts` returns serialized data for embedding (e.g., condensed code-map in root AGENTS.md) but writes no files.
- **Errors are swallowed, not thrown** in graph-builder — parse failures return empty/null. The graph must always complete.
- **`extractSubgraph` logic is mirrored** in `graph-context-prompt.mjs` (`buildNeighborhood()`). Keep both in sync.
- **doc-sync rebuilds graph on every sync** — calls `buildRepoGraph` + `persistGraphArtifacts` (with target) to keep it fresh.
- **Code-map output is sync-stable** — no totals, no dates, no hotspot churn counts, no `+N more` suffixes. Anything that varies between syncs without a real code change must stay out of generated context.

## References
- **Hook mirror:** `src/templates/hooks/graph-context-prompt.mjs`

---
**Last Updated:** 2026-05-11
