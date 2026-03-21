---
name: import-graph
description: Static import analysis that builds dependency graphs, domain clusters, hub files, git churn hotspots, and file priority rankings
---

## Activation

This skill triggers when editing import-graph-related files:
- `src/lib/graph-builder.js`
- `tests/graph-builder.test.js`

---

You are working on the **import graph builder** — a static analysis module that parses JS/TS and Python source files to produce dependency graphs, hub rankings, domain clusters, and churn-based hotspots.

## Key Files
- `src/lib/graph-builder.js` — All graph logic (691 lines, single file)
- `tests/graph-builder.test.js` — Tests using temp fixture directories
- `src/lib/scanner.js` — Provides `detectEntryPoints()`, the only internal dependency

## Architecture
`buildRepoGraph(repoPath, languages?)` is the sole public entry point. It runs a **9-step pipeline**:
1. Walk source files (skip `SKIP_DIRS`, vendored, generated)
2. Parse imports per file (es-module-lexer for JS/TS, regex for Python)
3. Populate `importedBy` reverse edges
4. Git churn analysis (6-month window via `git log`)
5. Compute per-file metrics (fanIn, fanOut, exportCount, churn, priority)
6. Rank files by priority descending
7. Identify hub files (top 20 by fanIn)
8. Domain clustering via BFS connected components
9. Identify hotspots (`churn > 3 && lines > 50`)

## Critical Rules
- **`await init` before any `parseJsImports` call.** es-module-lexer requires WASM initialization. `buildRepoGraph` calls it at the top; standalone usage of `parseJsImports` must also await it.
- **Priority formula is load-bearing:** `fanIn * 3.0 + exportCount * 1.5 + (isEntry ? 10.0 : 0) + churn * 2.0 + (1/(depth+1)) * 1.0`. Downstream consumers (doc-init, scan commands) depend on this ranking.
- **All paths are repo-relative strings** (e.g. `src/lib/scanner.js`), never absolute. Resolution functions convert abs→relative before returning.
- **Import resolution tries extensions in order:** `.js, .ts, .tsx, .jsx, .mjs` then `/index` variants. Changing this order changes which file wins when ambiguous.
- **Python regex uses global flags** — `lastIndex` is reset before each exec loop. Forgetting this causes missed imports.
- **Errors are swallowed, not thrown:** parse failures, unreadable files, and missing git all return empty/null. The graph must always complete.

## Key Patterns
- **Internal vs external imports:** Relative/aliased imports that resolve to a file on disk → internal (edges). Everything else → `externalImports` array (no edges).
- **Path alias support:** Reads `tsconfig.json`/`jsconfig.json` from root + monorepo subdirs. Strips comments before JSON.parse.
- **Tests use `createFixture(name, files)`** to build temp directories under `tests/fixtures/graph-builder/`, cleaned up in `afterAll`.

## Exported API
- `buildRepoGraph(repoPath, languages?)` — main entry, returns `{ files, edges, ranked, hubs, clusters, hotspots, entryPoints, stats }`
- `parseJsImports(content, relPath)` — `{ imports: string[], exports: string[] }`
- `parsePyImports(content)` — `string[]` of raw specifiers
- `resolveRelativeImport(repoPath, fromFile, specifier)` — `string | null`
- `computeDomainClusters(files, edges)` — `{ components, coupling }`

---
**Last Updated:** 2026-03-21
