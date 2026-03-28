---
name: import-graph
description: Static import analysis that builds dependency graphs, domain clusters, hub files, git churn hotspots, and file priority rankings
---

## Activation

This skill triggers when editing import-graph-related files:
- `src/lib/graph-builder.js`
- `src/lib/graph-persistence.js`
- `src/commands/doc-graph.js`
- `src/templates/hooks/graph-context-prompt.mjs`
- `src/templates/hooks/graph-context-prompt.sh`
- `tests/graph-builder.test.js`
- `tests/graph-persistence.test.js`

---

You are working on the **import graph system** — static analysis that parses JS/TS and Python source files to produce dependency graphs, plus persistence/query layers for runtime use.

## Key Files
- `src/lib/graph-builder.js` — Core graph logic: walk, parse, metrics, ranking, clustering (690 lines)
- `src/lib/graph-persistence.js` — Serialize, persist, load, subgraph extraction, code-map, graph-index
- `src/commands/doc-graph.js` — Standalone `aspens doc graph` command
- `src/lib/scanner.js` — Provides `detectEntryPoints()`, only internal dependency of graph-builder
- `src/templates/hooks/graph-context-prompt.mjs` — Standalone hook mirroring `extractSubgraph` logic
- `tests/graph-builder.test.js` — Graph builder tests using temp fixture directories
- `tests/graph-persistence.test.js` — Persistence layer tests

## Key Concepts
**graph-builder.js** — `buildRepoGraph(repoPath, languages?)` runs a 9-step pipeline:
1. Walk source files → 2. Parse imports → 3. Reverse edges → 4. Git churn → 5. Per-file metrics → 6. Priority ranking → 7. Hub detection → 8. Domain clustering → 9. Hotspots

**graph-persistence.js** — Persistence and query layer:
- `serializeGraph()` converts raw graph to indexed format (O(1) lookups, file→cluster mapping)
- `persistGraphArtifacts()` writes `.claude/graph.json` + `.claude/code-map.md` + `.claude/graph-index.json` + auto-gitignores them
- `extractSubgraph(graph, filePaths)` returns 1-hop neighborhood of mentioned files + relevant hubs/hotspots/clusters
- `formatNavigationContext(subgraph)` renders compact markdown (~50 line budget) for prompt injection
- `extractFileReferences(prompt, graph)` tiered extraction: explicit paths → bare filenames → cluster keywords
- `generateCodeMap()` / `writeCodeMap()` standalone overview for graph hook consumption
- `generateGraphIndex()` / `saveGraphIndex()` tiny inverted index (export names → files, hub basenames, cluster labels)

## Critical Rules
- **`await init` before any `parseJsImports` call.** es-module-lexer requires WASM initialization.
- **Priority formula is load-bearing:** `fanIn * 3.0 + exportCount * 1.5 + (isEntry ? 10.0 : 0) + churn * 2.0 + (1/(depth+1)) * 1.0`. Downstream consumers depend on this ranking.
- **All paths are repo-relative strings**, never absolute. Resolution functions convert abs→relative.
- **Graph artifacts are gitignored** — `ensureGraphGitignore()` (internal to persistence) adds `.claude/graph.json`, `.claude/graph-index.json`, `.claude/code-map.md` to prevent commit loops.
- **Errors are swallowed, not thrown** in graph-builder — parse failures return empty/null. The graph must always complete.
- **`extractSubgraph` logic is mirrored** in `graph-context-prompt.mjs` (`buildNeighborhood()`). Keep both in sync.
- **doc-sync rebuilds graph on every sync** — calls `buildRepoGraph` + `persistGraphArtifacts` to keep it fresh.

## References
- **Hook mirror:** `src/templates/hooks/graph-context-prompt.mjs`

---
**Last Updated:** 2026-03-28
