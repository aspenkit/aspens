---
name: repo-scanning
description: Deterministic repo analysis — language/framework detection, structure mapping, domain discovery, health checks, and import graph integration
triggers:
  files:
    - src/lib/scanner.js
    - src/lib/source-exts.js
    - src/lib/path-resolver.js
    - src/lib/parsers/typescript.js
    - src/lib/parsers/python.js
    - src/lib/frameworks/nextjs.js
    - src/commands/scan.js
    - tests/scanner.test.js
  keywords:
    - scanRepo
    - detectLanguages
    - detectFrameworks
    - detectDomains
    - detectEntryPoints
    - health check
    - SOURCE_EXTS
    - SKIP_DIR_NAMES
---

You are working on **aspens' repo scanning system** — a fully deterministic analyzer (no LLM calls) that detects languages, frameworks, structure, domains, entry points, size, and health issues for any repository.

## Domain purpose
Scanning is the foundation every other command builds on. `scanRepo()` must produce stable, reproducible results from any repo on disk — even a freshly-cloned one with no manifests parsed yet — so `doc init`, `doc sync`, `doc impact`, and `doc graph` can decide what to generate, which target (Claude / Codex) is appropriate, and which domains warrant skills. Determinism is the contract: the same repo at the same commit must always produce the same scan.

## Key Concepts
- **scanRepo() return shape:** `{ path, name, languages[], frameworks[], structure, domains[], entryPoints[], hasClaudeConfig, hasClaudeMd, hasCodexConfig, hasAgentsMd, repoType, size, health }` — order matters: `repoType` and `health` depend on prior fields
- **Multi-target detection:** Scanner checks for both `.claude` dir + `CLAUDE.md` (Claude Code) and `.codex` dir + `AGENTS.md` (Codex CLI) to inform target selection during `doc init`
- **Detection via marker files:** Languages detected by presence of files like `package.json`, `go.mod`, `Cargo.toml` — not by scanning source extensions
- **Framework detection:** JS/TS from `package.json` deps, Python from `requirements.txt`/`pyproject.toml`/`Pipfile`, Go from `go.mod` contents, Ruby from `Gemfile`
- **Domain detection:** Scans dirs under source root + repo root, skips `SKIP_DIR_NAMES` set (structural/build/IDE/.NET/Java/Rust build dirs), requires at least one source file via `collectModules()`
- **extraDomains:** User-specified domains merged via `mergeExtraDomains()` — marked with `userSpecified: true`, resolved against source root then repo root
- **Source root:** First match of `src`, `app`, `lib`, `server`, `pages` via `findSourceRoot()`; for nested-project layouts (e.g. `~/apps/MyApp/MyApp/MyApp.csproj`), if repo root has exactly one non-skip child with a project manifest, that child is promoted as the source root and excluded from domain scanning at repo root to avoid double-counting
- **Size estimation:** Lines estimated at ~40 bytes/line from `stat.size`, walk capped at depth 5, skips `bin`/`obj`/`target` build output alongside `node_modules`/`dist`/etc.
- **Graph is opt-out:** `scanCommand` builds graph by default (`options.graph !== false`); errors are caught and only logged with `--verbose`
- **Health checks are language-aware:** `.gitignore` checks for missing `node_modules/`, `__pycache__/`, `target/`, virtualenv dirs, and uncommitted `.env` files are gated on detected languages

## Critical Rules
- **`SOURCE_EXTS`** (in `src/lib/source-exts.js`): `.py`, `.ts`, `.js`, `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.rb`, `.go`, `.rs`, `.java`, `.kt`, `.kts`, `.cs`, `.fs`, `.fsx`, `.swift`, `.php`, `.ex`, `.exs` — adding a language requires updating this set AND the `detectLanguages` indicators. Import graph / hub / cluster detection remains JS/TS/Python-only; other languages get domain discovery but a minimal atlas.
- **`SKIP_DIR_NAMES`**: Includes `src`, `app`, `bin`, `obj`, `dist`, `target`, `node_modules`, etc. — skipped in domain detection. `bin`/`obj`/`target` added to avoid .NET/Java/Rust build artifacts.
- **`BOILERPLATE_STEMS`**: `__init__`, `index`, `mod` are excluded from module collection — don't add real module names here
- **TypeScript implies JavaScript**: TS detection in `detectLanguages()` automatically adds JS to the languages array
- **Graph failure is non-fatal**: `buildRepoGraph` errors in `scanCommand()` are caught and silently ignored unless `--verbose`
- **Tests use real filesystem fixtures**, not mocks — create fixtures with `createFixture(name, files)` pattern, always clean up
- **`detectEntryPoints` is exported** and reused by `graph-builder.js` — changing its signature breaks the graph builder
- **`es-module-lexer` must be initialized**: `parseJsImports()` awaits `init` before calling `parse()`. The lexer can fail on JSX-heavy files; the regex fallback in `parsers/typescript.js` is intentional graceful degradation, not dead code.
- **Python parser skips SCREAMING_SNAKE constants** by design — they produced false positives in code-map; do not re-add them.
- **Next.js entry points feed the import-graph priority ranker** — `app/`, `pages/`, and `middleware`/`instrumentation` files are roots Next.js runs implicitly with no static importer.

---
**Last Updated:** 2026-05-11
