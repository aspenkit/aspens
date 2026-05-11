---
name: skill-generation
description: LLM-powered generation pipeline for Claude Code skills and AGENTS.md — doc-init command, prompt system, context building, and output parsing
triggers:
  files:
    - src/commands/doc-init.js
    - src/lib/context-builder.js
    - src/prompts/**/*
  keywords:
    - doc-init
    - generate skills
    - discovery agents
    - chunked generation
    - recommended
---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude/Codex CLI to generate skills, hooks, and instructions files.

## Domain purpose
`aspens doc init` orchestrates a multi-step LLM pipeline that turns a scanned repo + import graph into a base skill, per-domain skills, and an instructions file (`AGENTS.md` or `AGENTS.md`). Generation is always done in Claude-canonical format and transformed for other targets afterwards. The end product is what other coding agents (and aspens' own hooks) consume to stay grounded in the repo.

## Critical files (purpose, not inventory)
- `src/commands/doc-init.js` — the pipeline orchestrator (backend → target → scan → graph → discovery → strategy → mode → generate → validate → transform → write → hooks → recommended extras → config)
- `src/lib/runner.js` — `runLLM()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()` shared across all LLM-driven commands
- `src/lib/skill-writer.js` — writes parsed files, generates `skill-rules.json`, injects domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — parses skill frontmatter, activation patterns, keywords (consumed by skill-writer)
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync (monorepo-aware)
- `src/lib/timeout.js` — `resolveTimeout()` for auto-scaled + user-override timeouts
- `src/lib/target.js` / `src/lib/backend.js` / `src/lib/target-transform.js` — target/backend resolution and Claude→other-target transform
- `src/prompts/` — `doc-init.md`, `doc-init-domain.md`, `doc-init-claudemd.md`, `discover-domains.md`, `discover-architecture.md`, plus `partials/` (skill-format, preservation-contract, examples)

## Key Concepts
- **Pipeline steps:** (1) detect backends (2) **backend selection** (3) **target selection** (4) scan + graph (5) existing docs discovery check (6) parallel discovery agents (7) strategy (8) mode (9) generate (10) validate (11) transform for non-Claude targets (12) show files + dry-run (13) write (14) install hooks (Claude-only) (15) **recommended extras** (save-tokens, agents, git hook) (16) persist config to `.aspens.json`
- **Early config persistence:** Target/backend config is written to `.aspens.json` **before** generation starts (after step 4), so a failed generation run still records the user's explicit target/backend choice. `saveTokens` from existing config is preserved. Final `writeConfig` at step 16 adds `saveTokens` from recommended install.
- **`--recommended` flag:** Skips interactive prompts with smart defaults. Reuses existing target config from `.aspens.json`. Auto-selects backend from target. Defaults strategy to `improve` when existing docs found. Auto-picks discovery skip when docs exist. Auto-selects generation mode based on repo size. **Also installs save-tokens, bundled Claude agents, `dev/` gitignore entry, and doc-sync git hook** (step 15).
- **Recommended extras (step 15):** When `--recommended` and not `--dry-run`: calls `installSaveTokensRecommended()` from `save-tokens.js` (if Claude target), copies all bundled agent templates to `.claude/agents/` (skips existing) via `installRecommendedClaudeAgents()`, adds `dev/` to `.gitignore`, installs doc-sync git hook if not present. Summary lines printed after.
- **Backend before target:** Backend selection (step 2) happens before target selection (step 3). If both CLIs available, user picks backend first, then targets. Pre-selects matching target in the multiselect. With `--recommended`, backend is inferred from existing target config.
- **Canonical generation:** All prompts receive `CANONICAL_VARS` (hardcoded Claude paths: `.claude/skills`, `skill.md`, `AGENTS.md`, `.claude`). Generation always produces Claude-canonical format regardless of target. Non-Claude targets are produced by post-generation transform via `transformForTarget()`.
- **Incremental writing (chunked mode):** When `mode === 'chunked'` and not dry-run, generated files are written to disk as each chunk completes instead of waiting until the end. User is prompted to confirm incremental writes before generation starts. Helper functions: `validateGeneratedChunk()` validates and strips truncated files per chunk; `buildOutputFilesForTargets()` handles multi-target transform; `writeIncrementalOutputs()` deduplicates and writes changed files. Tracks written content via `incrementalWriteState` (`contentsByPath` + `resultsByPath` Maps). When incremental mode is active, post-generation validation/transform/confirm/write steps are skipped (already done per-chunk).
- **`parseLLMOutput` with strict single-file fallback:** Codex often returns plain markdown without `<file>` tags. `parseLLMOutput(text, allowedPaths, expectedPath)` only wraps tagless text as the expected file for **true single-file prompts** (exactly one `exactFile` in allowedPaths, no `dirPrefixes`). Multi-file prompts require proper `<file>` tags.
- **Existing docs reuse:** When existing Claude docs are found and strategy is `improve`, `loadExistingDocsContext()` inlines them as `## Existing Docs (improve these — preserve hand-written rules...)` into the prompt. `chooseReuseSourceTarget()` decides whether Claude or Codex docs are the source. Supports cross-target reuse (e.g. Claude docs → Codex output).
- **Domain reuse helpers:** `loadReusableDomains()` tries `loadReusableDomainsFromRules()` first (reads `skill-rules.json`), falls back to `findSkillFiles()` with `extractKeyFilePatterns()` parsing `## Key Files` blocks.
- **Config persistence with target merging:** Uses `mergeConfiguredTargets()` to avoid dropping previously configured targets. `writeConfig` now also persists `saveTokens` config from the recommended install.
- **Hook installation:** Only for targets with `supportsHooks: true` (Claude). `installHooks()` generates `skill-rules.json`, copies hook scripts, injects generated domain patterns into `post-tool-use-tracker.sh` via `# BEGIN/END detect_skill_domain` markers, merges `settings.json` (backs up existing to `.bak`).
- **Git hook offer:** With `--recommended`, git hook is auto-installed (no prompt). Without `--recommended`, interactive prompt offered. Detection looks for the marker string `aspens doc-sync hook (<rel>)` in `.git/hooks/post-commit`.
- **Discovery agents:** Two LLM calls run in parallel — `discover-domains` (hub files + domain clusters) and `discover-architecture` (hub files + ranked + hotspots). Findings are merged into `discoveryFindings` and parsed; domain-specific slices are injected into each domain prompt as `## Discovery Findings for {domain}`.

## Critical Rules
- **Base skill + instructions file are essential** — pipeline retries up to 2× with format-correction prompts when `<file>` tags are missing. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — LLM must read existing skills first and not discard human-authored rules. The preservation-contract partial enforces this in every prompt.
- **Discovery runs before user prompt** — domain picker shows discovered domains, not scanner directory names. Falls back to scanner domains if discovery fails.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent calls. Base skill always sequential first. Instructions file always sequential last.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.
- **`--hooks-only` is Claude-only** — hardcoded to `TARGETS.claude` regardless of config.
- **Incremental write deduplication** — `writeIncrementalOutputs()` skips files whose content hasn't changed since last write, using `contentsByPath` Map for tracking. Directory-scoped `AGENTS.md` files (path ends with `/AGENTS.md` but not the root `AGENTS.md`) go through `writeTransformedFiles()`, all others through `writeSkillFiles()`.
- **Read-only LLM tools** — generation calls always pass `allowedTools: ['Read', 'Glob', 'Grep']`. The LLM explores the repo itself; aspens never lets it write.
- **`AGENTS.md` post-processing** — generated instructions files are run through `ensureRootKeyFilesSection()`, `syncSkillsSection()`, and `syncBehaviorSection()` so aspens owns the Skills list and Behavior block deterministically; prompts explicitly forbid the LLM from emitting these sections.

## References
- **Prompts:** `src/prompts/doc-init*.md`, `src/prompts/discover-*.md`
- **Partials:** `src/prompts/partials/skill-format.md`, `src/prompts/partials/preservation-contract.md`, `src/prompts/partials/examples.md`

---
**Last Updated:** 2026-05-11
