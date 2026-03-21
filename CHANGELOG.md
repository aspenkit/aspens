# Changelog

## [Unreleased]

### Added
- **Import graph** — parses JS/TS imports (via `es-module-lexer`) and Python imports (regex), resolves `@/` path aliases from tsconfig.json, builds dependency map
- **Hub file detection** — identifies most-imported files with fan-in ranking and priority scores
- **Domain clustering** — groups files by import relationships (connected components), not just directory names
- **Inter-domain coupling** — shows how many imports cross domain boundaries
- **Git churn analysis** — file change frequency over 6 months, hotspot detection (high churn + high complexity)
- **Parallel discovery** — 2 Claude agents explore simultaneously (domain discovery + architecture analysis) before skill generation
- **Discovered domains** — Claude finds real feature domains (auth, billing, courses) instead of just directory names (components, lib, hooks)
- **Parallel skill generation** — generates up to 3 domain skills concurrently
- **Discovery-first flow** — discovery runs before user chooses domains, so the picker shows meaningful feature names
- **Health checks** — warns about missing .gitignore, unignored node_modules, exposed .env files
- **`--domains` flag** — for both `scan` and `doc init`, lets users specify additional domains
- **`--verbose` flag** for `scan` — shows diagnostic output when graph building fails
- **Elapsed time** in token summary — shows total wall-clock time for doc init
- **Hotspots display** in scan output — shows files with high recent churn
- **Python package root detection** — resolves absolute imports from multiple source roots (backend/, src/, etc.)
- **Dynamic version** — reads from package.json instead of hardcoding

### Changed
- Domain detection now uses import graph clustering instead of hardcoded SaaS keyword patterns
- Scan output shows import graph (hub files, domains by imports, coupling matrix, hotspots) instead of just directory listings
- Doc init runs discovery pass before asking user to choose domains
- Skill generation uses discovery findings for richer, more specific skills

### Fixed
- Edges no longer include unresolved imports (phantom edges to non-existent files)
- Trailing space in directory module names
- Overly broad `.gitignore` venv pattern matching (`env/` no longer matches `development/`)
- Test fixture cleanup race condition between test suites
- Python relative imports with `./` prefix no longer use JS extension resolution

### Removed
- Hardcoded SaaS domain patterns (auth, billing, users, etc.) — replaced by import graph clustering
- Dead code: `collectFileHints()`, `collectDirs()`, `GENERIC_FILE_NAMES`
- Unused `parallel-runner.js` and `discover.md`

## [0.1.0] - 2026-03-18

### Added
- `aspens scan` — deterministic tech stack, structure, and domain detection
- `aspens doc init` — generate skills and CLAUDE.md via Claude
- `aspens doc sync` — update skills from git diffs
- `aspens doc sync --install-hook` — auto-sync on every commit with 5-minute cooldown
- `aspens add` — install agents, hooks, and slash commands from bundled library
- `aspens customize agents` — inject project context into installed agents
- Chunked generation mode for large repos
- Auto-scaling timeout based on repo size
- `--model` flag for choosing Claude model (sonnet, opus, haiku)
- `--verbose` mode to see Claude's exploration in real time
- Token usage summary after generation
- Repo size estimation in scan output
- Existing docs strategy: improve, rewrite, or skip
- 9 bundled agents, 2 hooks, 2 slash commands
- Test suite (vitest, 69 tests)
