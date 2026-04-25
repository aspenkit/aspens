# Changelog

## [0.7.3] - 2026-04-25

### Fixed
- **`doc sync` crash on unstructured LLM response** — when the LLM responds with explanatory text instead of `<file>` tags, `doc sync` now treats it as "no updates needed" instead of throwing. Also tightened the prompt to request an empty response when nothing needs updating.
- **Codex `AGENTS.md` missing most content** — the codex transform produced only hub files and domain clusters (~17 lines) instead of the full instructions derived from `CLAUDE.md`. The transform now loads `CLAUDE.md` from disk when it's not in the canonical files (e.g., during `doc init --strategy skip-existing` or incremental `doc sync`).


## [0.7.2] - 2026-04-16

### Fixed
- **Nested-project source root detection** — for layouts like `.NET`'s `~/apps/MyApp/MyApp/MyApp.csproj` (where the outer dir holds `README`/`.git`/`CLAUDE.md` and a single inner dir holds the `.csproj`), `findSourceRoot()` now promotes the inner dir as the source root. Subdirectories like `Controllers/` and `Services/` surface as first-class domains instead of being rolled up under a single wrapper domain. Triggered only when the repo root has exactly one non-skip child directory containing a project manifest (`.csproj`, `.sln`, `pom.xml`, `go.mod`, `package.json`, `pyproject.toml`, etc.).
- **`scan` pretty-printer shows domains for non-JS/TS/Python projects** — the `Domains` section was hidden whenever the import graph returned 0 clusters, which always happened for C#/Java/Swift/PHP/Elixir repos. The pretty-printer now falls back to scanner's filesystem domains under a `Domains (by filesystem)` heading when the graph has no clusters.

## [0.7.1] - 2026-04-16

### Fixed
- **Domain discovery for C#, Java, Swift, PHP, and Elixir** — scanner's `SOURCE_EXTS` only recognized JS/TS/Python/Ruby/Go/Rust files, so `doc init` reported zero domains for projects in other languages even when language detection itself succeeded. Added `.cs`, `.java`, `.swift`, `.php`, `.ex`, `.exs`, `.mjs`, and `.cjs` to the source-extension set. Kotlin (`.kt`/`.kts`) and F# (`.fs`/`.fsx`) files are also counted as source now; full language detection for those will follow in a future release.
- **Build-output skipping** — repo-size estimation now skips `bin/`, `obj/`, and `target/` directories, and domain detection also skips `obj/`, preventing .NET / Java / Rust build artifacts from polluting module lists or line counts.

### Known Limitations
- Import graph, hub files, and cluster detection remain JS/TS/Python-only — `doc init` on C#/Java/Swift/PHP/Elixir/Kotlin/Rust/Go/Ruby projects will generate skills and domains but produce a minimal atlas. Full multi-language import parsing is tracked for a future release.

## [0.7.0] - 2026-04-10

### Added
- **`aspens doc impact`** — new context-health command that reports freshness, coverage, drift, hook status, save-tokens health, and recommended repair actions
- **Save-tokens setup** — installable session-optimization settings, prompt guards, precompact handoffs, statusline telemetry, and handoff commands for supported environments
- **Bundled agents and commands** — expanded agent library plus handoff/resume command templates for installed Claude workflows

### Changed
- **Chunked generation durability** — `doc init --mode chunked` now asks for write approval up front and writes generated files incrementally so successful chunks survive later failures
- **Target persistence** — `doc init` now saves the selected target/backend earlier so an interrupted run still updates `.aspens.json`
- **README positioning** — tightened the README around stale agent context, scoped skills, and the one-command setup flow
- **Package metadata** — npm description and upgrade messaging now align with the current product focus on keeping coding-agent context accurate

### Fixed
- **Codex CLI compatibility** — `runCodex()` now detects whether the installed Codex CLI supports `--ask-for-approval` instead of assuming an older flag contract
- **Subdirectory monorepo support** — improved handling for subdirectory projects across repo config and impact flows
- **Hook/runtime reliability** — follow-up fixes for hook execution errors, save-tokens plumbing, and generated skill/template consistency

## [0.6.0] - 2026-04-07

### Changed
- **Codex support hardening** — shared backend routing now uses a single `runLLM` implementation across commands, and Codex execution runs under read-only sandboxing with `--ask-for-approval never` instead of `--full-auto`
- **Config recovery** — `.aspens.json` parsing now validates schema before use, malformed configs fall back to inference, and recovered multi-target configs are rewritten safely
- **Multi-target publishing** — `doc sync` now forwards serialized graph data into target transforms so Codex architecture skill output is emitted when graph artifacts exist
- **Path allowlisting** — target path validation is stricter for transformed writes and parsed output, keeping `.claude/`, `.agents/skills/`, `.codex/`, `CLAUDE.md`, and `AGENTS.md` scoped correctly
- **Skill discovery** — reusable-domain loading now falls back to skill rules and key-file extraction when Codex-transformed skills omit `## Activation`

### Fixed
- **Silent sync success on bad model output** — `doc sync` now treats non-empty unparseable replies as errors instead of reporting “Docs are up to date”
- **Single-file fallback wrapping** — `doc init` only wraps tagless model output when the prompt truly targets a single file, preventing multi-file replies from collapsing into `CLAUDE.md`
- **Customize validation order** — `aspens customize agents` now reports unknown targets before applying Codex-only gating
- **Prompt templates** — `doc-sync` and `doc-sync-refresh` no longer hardcode `billing` in output paths
- **Skill reader scope** — `findSkillFiles()` now matches the configured skill filename only, avoiding accidental reads of unrelated markdown files
- **Hook log output** — graph hook stderr extraction now preserves quoted path segments in `[Graph] ...` messages

### Security
- **Vite advisory remediation** — upgraded `vitest` to `4.1.3`, which updates transitive `vite` to `8.0.7` and clears the current Dependabot alerts for `server.fs.deny` bypass, arbitrary file read via dev-server WebSocket, and optimized deps `.map` path traversal

### Tests
- **Config validation coverage** — added tests for invalid but parseable `.aspens.json` files and updated target-path expectations for the narrowed allowlist

## [0.5.0] - 2026-03-28

### Added
- **Token optimizer** — reduces prompt token usage across all skill and agent templates while preserving semantic content; auto-trims discovery, generation, and sync prompts
- **Plan + execute agent pair** — two new agent templates for structured plan-then-execute workflows
- **`doc graph --remove`** — remove graph artifacts (graph.json, graph-index.json, code-map.md) from a repo
- **Dev docs commands** — refreshed `dev-docs` and `dev-docs-update` command templates

### Changed
- **CLAUDE.md generation** — improved code-running rule in generated CLAUDE.md files

## [0.4.0] - 2026-03-24

### Added
- **`doc sync --refresh`** — review and update all skills against the current codebase state without requiring a git diff
- **`add skill` command** — scaffold custom skills (`aspens add skill my-convention`) or generate from reference docs (`aspens add skill release --from dev/release.md`)
- **Interactive file picker** — when diff exceeds 80k chars, prompts to select which files Claude should analyze (skill-relevant files pre-selected)
- **Diff prioritization** — skill-relevant files get 60k of the 80k char budget so they survive truncation
- **Git hook hardening** — 5-minute cooldown, skip aspens-only commits, log rotation, stale lock cleanup, POSIX-compatible cleanup
- **Graph artifact gitignore** — `graph.json`, `graph-index.json`, `code-map.md` auto-added to `.gitignore` to prevent sync loops
- **35 new tests** — coverage for `resolveTimeout`, activation matching (`getActivationBlock`, `fileMatchesActivation`), `skillToDomain`, and `add skill` scaffold mode (162 → 197 tests)

### Changed
- **Module split** — extracted `git-helpers.js`, `diff-helpers.js`, `git-hook.js` from doc-sync.js (813 → 540 lines); pure orchestration remains
- **Shared activation matching** — deduplicated 3 copies of file-to-skill matching into `getActivationBlock()` and `fileMatchesActivation()` in skill-reader.js, fixing inconsistent regex
- **Security hardening** — all git commands use `execFileSync` (no shell interpolation), `chmodSync` replaces shell `chmod`, `fileMatchesActivation` guards against empty inputs
- **Skill rules regeneration** — `doc sync` now regenerates `skill-rules.json` after every write (was only done in refresh mode)
- **Consistent timeout warnings** — all three commands (`doc-sync`, `doc-init`, `customize`) now surface warnings for invalid `ASPENS_TIMEOUT` values
- **CliError cause chain** — errors from Claude calls now preserve the original error via `{ cause: err }` for better debugging
- **Gitignore matching** — line-based `Set` lookup replaces substring `includes()` to prevent false positives

### Fixed
- **Empty file selection** — interactive picker now cancels cleanly instead of silently sending the full diff when all files are deselected
- **Mid-line truncation** — `truncateDiff` falls back to last newline boundary instead of cutting mid-line when no hunk boundary is found

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
