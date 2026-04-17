---
name: repo-scanning
description: Deterministic repo analysis — language/framework detection, structure mapping, domain discovery, health checks, and import graph integration
---

## Activation

This skill triggers when editing repo-scanning files:
- `src/lib/scanner.js`
- `src/commands/scan.js`
- `tests/scanner.test.js`

Keywords: scanRepo, detectLanguages, detectFrameworks, detectDomains, detectEntryPoints, health check

---

You are working on **aspens' repo scanning system** — a fully deterministic analyzer (no LLM calls) that detects languages, frameworks, structure, domains, entry points, size, and health issues for any repository.

## Key Files
- `src/lib/scanner.js` — Core `scanRepo()` function and all detection logic (languages, frameworks, structure, domains, entry points, size, health)
- `src/commands/scan.js` — CLI command that calls `scanRepo()`, optionally builds import graph via `graph-builder.js`, and renders pretty or JSON output. Contains `formatGraphForDisplay()` which transforms raw graph data into display-ready shape
- `src/lib/graph-builder.js` — Builds import graph; imports `detectEntryPoints` from scanner. Called by `scanCommand` but graph failure is non-fatal
- `tests/scanner.test.js` — Uses temporary fixture directories created in `tests/fixtures/scanner/`, cleaned up in `afterAll`

## Key Concepts
- **scanRepo() return shape:** `{ path, name, languages[], frameworks[], structure, domains[], entryPoints[], hasClaudeConfig, hasClaudeMd, hasCodexConfig, hasAgentsMd, repoType, size, health }` — order matters: `repoType` and `health` depend on prior fields
- **Multi-target detection:** Scanner checks for both `.claude` dir + `AGENTS.md` (Claude Code) and `.codex` dir + `AGENTS.md` (Codex CLI) to inform target selection during `doc init`
- **Detection via marker files:** Languages detected by presence of files like `package.json`, `go.mod`, `Cargo.toml` — not by scanning source extensions
- **Framework detection:** JS/TS from `package.json` deps, Python from `requirements.txt`/`pyproject.toml`/`Pipfile`, Go from `go.mod` contents, Ruby from `Gemfile`
- **Domain detection:** Scans dirs under source root + repo root, skips `SKIP_DIR_NAMES` set (structural/build/IDE/.NET/Java/Rust build dirs), requires at least one source file via `collectModules()`
- **extraDomains:** User-specified domains merged via `mergeExtraDomains()` — marked with `userSpecified: true`, resolved against source root then repo root
- **Source root:** First match of `src`, `app`, `lib`, `server`, `pages` via `findSourceRoot()`
- **Size estimation:** Lines estimated at ~40 bytes/line from `stat.size`, walk capped at depth 5, skips `bin`/`obj`/`target` build output alongside `node_modules`/`dist`/etc.
- **Graph is opt-out:** `scanCommand` builds graph by default (`options.graph !== false`); errors are caught and only logged with `--verbose`

## Critical Rules
- **`SOURCE_EXTS`**: `.py`, `.ts`, `.js`, `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.kts`, `.cs`, `.fs`, `.fsx`, `.swift`, `.php`, `.ex`, `.exs` — adding a language requires updating this set AND the `detectLanguages` indicators. Import graph / hub / cluster detection remains JS/TS/Python-only; other languages get domain discovery but a minimal atlas.
- **`SKIP_DIR_NAMES`**: Includes `src`, `app`, `bin`, `obj`, `dist`, `target`, `node_modules`, etc. — skipped in domain detection. `bin`/`obj`/`target` added to avoid .NET/Java/Rust build artifacts.
- **`BOILERPLATE_STEMS`**: `__init__`, `index`, `mod` are excluded from module collection — don't add real module names here
- **TypeScript implies JavaScript**: TS detection in `detectLanguages()` automatically adds JS to the languages array
- **Graph failure is non-fatal**: `buildRepoGraph` errors in `scanCommand()` are caught and silently ignored unless `--verbose`
- **Tests use real filesystem fixtures**, not mocks — create fixtures with `createFixture(name, files)` pattern, always clean up
- **`detectEntryPoints` is exported** and reused by `graph-builder.js` — changing its signature breaks the graph builder

## References
- **No guidelines directory** — `.claude/guidelines/` does not exist yet for this domain

---
**Last Updated:** 2026-04-16
