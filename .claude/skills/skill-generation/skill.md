---
name: skill-generation
description: LLM-powered generation pipeline for Claude Code skills and CLAUDE.md — doc-init command, prompt system, context building, and output parsing
---

## Activation

This skill triggers when editing skill-generation files:
- `src/commands/doc-init.js`
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/lib/skill-reader.js`
- `src/lib/git-hook.js`
- `src/lib/timeout.js`
- `src/prompts/**/*`

Keywords: doc-init, generate skills, discovery agents, chunked generation, recommended

---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude/Codex CLI to generate skills, hooks, and instructions files.

## Key Files
- `src/commands/doc-init.js` — Main pipeline: backend selection → target selection → scan → graph → discovery → strategy → mode → generate → validate → transform → write → hooks → recommended extras → config
- `src/lib/runner.js` — `runClaude()`, `runCodex()`, `runLLM()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`
- `src/lib/skill-writer.js` — Writes files, generates `skill-rules.json`, domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — Parses skill frontmatter, activation patterns, keywords (used by skill-writer)
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync (monorepo-aware)
- `src/lib/timeout.js` — `resolveTimeout()` for auto-scaled + user-override timeouts
- `src/lib/target.js` — Target definitions, `resolveTarget()`, `getAllowedPaths()`, `writeConfig()`, `loadConfig()`, `mergeConfiguredTargets()`
- `src/lib/backend.js` — Backend detection/resolution (`detectAvailableBackends()`, `resolveBackend()`)
- `src/lib/target-transform.js` — `transformForTarget()`, `ensureRootKeyFilesSection()` converts Claude output to other target formats
- `src/prompts/` — `doc-init.md` (base), `doc-init-domain.md`, `doc-init-claudemd.md`, `discover-domains.md`, `discover-architecture.md`

## Key Concepts
- **Pipeline steps:** (1) detect backends (2) **backend selection** (3) **target selection** (4) scan + graph (5) existing docs discovery check (6) parallel discovery agents (7) strategy (8) mode (9) generate (10) validate (11) transform for non-Claude targets (12) show files + dry-run (13) write (14) install hooks (Claude-only) (15) **recommended extras** (save-tokens, agents, git hook) (16) persist config to `.aspens.json`
- **Early config persistence:** Target/backend config is written to `.aspens.json` **before** generation starts (after step 4), so a failed generation run still records the user's explicit target/backend choice. `saveTokens` from existing config is preserved. Final `writeConfig` at step 16 adds `saveTokens` from recommended install.
- **`--recommended` flag:** Skips interactive prompts with smart defaults. Reuses existing target config from `.aspens.json`. Auto-selects backend from target. Defaults strategy to `improve` when existing docs found. Auto-picks discovery skip when docs exist. Auto-selects generation mode based on repo size. **Also installs save-tokens, bundled Claude agents, `dev/` gitignore entry, and doc-sync git hook** (step 15).
- **Recommended extras (step 15):** When `--recommended` and not `--dry-run`: calls `installSaveTokensRecommended()` from `save-tokens.js` (if Claude target), copies all bundled agent templates to `.claude/agents/` (skips existing), adds `dev/` to `.gitignore`, installs doc-sync git hook if not present. Summary lines printed after.
- **Backend before target:** Backend selection (step 2) happens before target selection (step 3). If both CLIs available, user picks backend first, then targets. Pre-selects matching target in the multiselect. With `--recommended`, backend is inferred from existing target config.
- **Canonical generation:** All prompts receive `CANONICAL_VARS` (hardcoded Claude paths). Generation always produces Claude-canonical format regardless of target. Non-Claude targets are produced by post-generation transform.
- **Incremental writing (chunked mode):** When `mode === 'chunked'` and not dry-run, generated files are written to disk as each chunk completes instead of waiting until the end. User is prompted to confirm incremental writes before generation starts. Helper functions: `validateGeneratedChunk()` validates and strips truncated files per chunk; `buildOutputFilesForTargets()` handles multi-target transform; `writeIncrementalOutputs()` deduplicates and writes changed files. Tracks written content via `incrementalWriteState` (`contentsByPath` + `resultsByPath` Maps). When incremental mode is active, post-generation validation/transform/confirm/write steps are skipped (already done per-chunk).
- **`parseLLMOutput` with strict single-file fallback:** Codex often returns plain markdown without `<file>` tags. `parseLLMOutput(text, allowedPaths, expectedPath)` only wraps tagless text as the expected file for **true single-file prompts** (exactly one `exactFile` in allowedPaths, no `dirPrefixes`). Multi-file prompts require proper `<file>` tags.
- **Existing docs reuse:** When existing Claude docs are found and strategy is `improve`, reuse is handled as improvement context without a separate loading spinner. Supports cross-target reuse.
- **Domain reuse helpers:** `loadReusableDomains()` tries `loadReusableDomainsFromRules()` first, falls back to `findSkillFiles()` with `extractKeyFilePatterns()`.
- **Config persistence with target merging:** Uses `mergeConfiguredTargets()` to avoid dropping previously configured targets. `writeConfig` now also persists `saveTokens` config from the recommended install.
- **Hook installation:** Only for targets with `supportsHooks: true` (Claude). Generates `skill-rules.json`, copies hook scripts, merges `settings.json`.
- **Git hook offer:** With `--recommended`, git hook is auto-installed (no prompt). Without `--recommended`, interactive prompt offered.

## Critical Rules
- **Base skill + instructions file are essential** — pipeline retries automatically with format correction. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — LLM must read existing skills first and not discard human-authored rules.
- **Discovery runs before user prompt** — domain picker shows discovered domains, not scanner directory names.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent calls. Base skill always sequential first. Instructions file always sequential last.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.
- **`--hooks-only` is Claude-only** — hardcoded to `TARGETS.claude` regardless of config.
- **Incremental write deduplication** — `writeIncrementalOutputs()` skips files whose content hasn't changed since last write, using `contentsByPath` Map for tracking.

## References
- **Prompts:** `src/prompts/doc-init*.md`, `src/prompts/discover-*.md`
- **Partials:** `src/prompts/partials/skill-format.md`, `src/prompts/partials/examples.md`

---
**Last Updated:** 2026-04-10
