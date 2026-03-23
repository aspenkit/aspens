# Changelog

## [Unreleased]

## [0.3.0] - 2026-03-23

### Added
- **Import graph persistence** — `aspens doc graph` analyzes the repo and saves `.claude/graph.json`, `.claude/graph-index.json`, and `.claude/code-map.md` for use across sessions
- **Graph context hook** — `graph-context-prompt.sh` + `graph-context-prompt.mjs` inject navigation context (hub files, clusters, neighbors) into every Claude prompt when relevant files are mentioned
- **Code-map skill** — auto-generated `.claude/code-map.md` gives Claude a codebase overview (hub files, domain clusters, hotspots, stats) loaded on every prompt
- **`aspens doc graph` command** — standalone command to build and persist the import graph with stats output
- **Graph-aware doc sync** — `aspens doc sync` now rebuilds the graph on every sync and uses it to improve skill change detection
- **`--domains` flag for `doc init`** — retry specific failed domains without regenerating the base skill or CLAUDE.md: `aspens doc init --mode chunked --domains "auth,payments"`

### Fixed
- **Windows `spawn` ENOENT** — Claude CLI now resolves correctly on Windows where npm installs `claude.cmd`; `shell: true` scoped to win32 only
- **Windows timeout kill** — timeout handler now uses `taskkill /t /f` on Windows to kill the full process tree, not just the shell
- **`base-only` mode skipping base skill** — split `skipDiscovery` into `isBaseOnly`/`isDomainsOnly` so base-only runs correctly generate the base skill and show the existing-docs strategy prompt
- **`--domains` with non-chunked modes** — `--domains` flag no longer erroneously skips discovery when used with `--mode all`
- **Retry hints include repo path** — skipped-domain retry commands now include the target repo path
- **Graph hook portability** — removed `timeout 5s` (requires GNU coreutils); timeout is now a portable `setTimeout` inside the Node script
- **Graph persistence error handling** — spinner correctly stops on `persistGraphArtifacts` failure; wrong output path in outro corrected
- **`clusters.components` null guard** — defensive check added in `doc graph` stats output
- **`graph.ranked` guard** — `buildGraphContext` uses optional chaining on `ranked` to handle serialized graphs
- **`externalImports` guard** — `buildDomainGraphContext` safely handles serialized graphs where `externalImports` is dropped
- **Silent graph failures** — `doc sync` now warns the user when graph context is unavailable instead of silently skipping
- **Node 18/20 test compatibility** — `import.meta.dirname` replaced with portable `fileURLToPath` + `dirname` pattern in graph persistence tests
- **Shell `local` masking** — `local dir=` in `graph-context-prompt.sh` split into separate declaration and assignment

## [0.2.2] - 2026-03-22

### Upgrade notice
If upgrading from 0.2.1 or earlier, run `aspens doc init --hooks-only` in each repo that already has skills.

### Added
- **Skill activation hooks** — `doc init` now auto-generates `skill-rules.json`, shell + Node.js hooks, and `settings.json` entries so skills activate automatically on every prompt
- **Session-sticky skills** — editing a file activates its domain skill for the rest of the session via `PostToolUse` tracking hook
- **`--hooks-only` flag** — run `aspens doc init --hooks-only` to install/update hooks without regenerating skills
- **`--no-hooks` flag** — skip hook installation during `doc init`
- **Missing hooks warning** — CLI warns when skills exist but activation hooks are missing, with fix command
- **Postinstall upgrade notice** — npm prints a message after install/update telling users to run `--hooks-only` if upgrading
- **Domain skill validation** — `validateSkillFiles` now checks for required sections (Activation, Key Files, Key Concepts, Critical Rules)

### Fixed
- **Hook settings merge** — order-independent duplicate detection using stable key-sorted stringify
- **Bash pattern injection** — `generateDomainPatterns` validates patterns against a safe character whitelist before emitting bash conditions
- **Keyword normalization** — `dedupeStrings` trims whitespace and strips trailing punctuation while preserving original casing
- **Dry-run side effects** — `mkdirSync` for hooks directory now guarded by `!options.dryRun`
- **Dry-run feedback** — rules file write now logs a message during `--dry-run` instead of silently skipping
- **`--no-hooks` CLI mapping** — uses Commander's `options.hooks !== false` instead of broken `options.noHooks`
- **Path containment** — `readSkillContent` and `validateSkillFiles` use `path.relative()` instead of hardcoded `/` separator
- **Session file location** — shell hooks use `${TMPDIR:-/tmp}` to match Node's `os.tmpdir()`
- **Session repo check** — `getSessionActiveSkills` validates `session.repo` matches current repo before returning sticky skills
- **Marker-based replacement** — `detect_skill_domain` stub uses `BEGIN/END` markers instead of fragile regex
- **Fence detection** — `parseFileOutput` handles fenced code blocks at start-of-string and unclosed fences
- **`</file>` at position 0** — closing tag regex matches start-of-string, not just after newline
- **Portable hash** — git hook falls back from `shasum` to `sha1sum` to `md5sum`
- **Windows path lookup** — `resolveAspensPath` uses `where` on win32, `which` elsewhere

## [0.2.1] - 2026-03-21

### Added
- **CLAUDE.md retry logic** — if Claude generates content without `<file>` tags, aspens detects the failure and retries with a format reminder
- **Base skill retry logic** — same retry mechanism for the base skill
- **Subdirectory tsconfig resolution** — path aliases (`@/`) now resolved from tsconfigs in `frontend/`, `apps/*`, `packages/*`, not just repo root
- **Vendored/generated code exclusion** — skips `*.min.js`, `*_generated.*`, `*_pb2.py`, lock files, and files with generated-code markers in first line
- **Common Recipes** wiki page
- **Release Process** wiki page
- **Logo** in README

### Fixed
- Python import regex now handles 4+ dot relative imports (`....models`)
- `parseFileOutput` in parallel runner wrapped in try/catch to prevent usage data loss
- Scan command logs graph errors in `--verbose` mode instead of silent catch
- Regex escape for domain names with metacharacters in findings extraction
- Dead `runDiscovery` function removed
- `parallel-runner.js` reference removed from CONTRIBUTING.md

## [0.2.0] - 2026-03-20

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
