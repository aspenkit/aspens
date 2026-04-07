---
name: skill-generation
description: LLM-powered generation pipeline for Claude Code skills and AGENTS.md — doc-init command, prompt system, context building, and output parsing
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

Keywords: doc-init, generate skills, discovery agents, chunked generation

---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude/Codex CLI to generate skills, hooks, and instructions files.

## Key Files
- `src/commands/doc-init.js` — Main pipeline: backend selection → target selection → scan → graph → discovery → strategy → mode → generate → validate → transform → write → hooks → config
- `src/lib/runner.js` — `runClaude()`, `runCodex()`, `runLLM()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`
- `src/lib/skill-writer.js` — Writes files, generates `skill-rules.json`, domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — Parses skill frontmatter, activation patterns, keywords (used by skill-writer)
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync
- `src/lib/timeout.js` — `resolveTimeout()` for auto-scaled + user-override timeouts
- `src/lib/target.js` — Target definitions, `resolveTarget()`, `getAllowedPaths()`, `writeConfig()`
- `src/lib/backend.js` — Backend detection/resolution (`detectAvailableBackends()`, `resolveBackend()`)
- `src/lib/target-transform.js` — `transformForTarget()` converts Claude output to other target formats
- `src/prompts/` — `doc-init.md` (base), `doc-init-domain.md`, `doc-init-claudemd.md`, `discover-domains.md`, `discover-architecture.md`

## Key Concepts
- **Pipeline steps:** (1) detect backends (2) **backend selection** (3) **target selection** (4) scan + graph (5) existing docs discovery check (6) parallel discovery agents (7) strategy (8) mode (9) generate (10) validate (11) transform for non-Claude targets (12) show files + dry-run (13) write (14) install hooks (Claude-only) (15) persist config to `.aspens.json`
- **Backend before target:** Backend selection (step 2) happens before target selection (step 3). If both CLIs available, user picks backend first, then targets. Pre-selects matching target in the multiselect.
- **Canonical generation:** All prompts receive `CANONICAL_VARS` (hardcoded Claude paths: `.claude/skills/`, `skill.md`, `AGENTS.md`). Generation always produces Claude-canonical format regardless of target. Non-Claude targets are produced by post-generation transform.
- **`parseLLMOutput` with strict single-file fallback:** Codex often returns plain markdown without `<file>` tags. `parseLLMOutput(text, allowedPaths, expectedPath)` only wraps tagless text as the expected file for **true single-file prompts** (exactly one `exactFile` in allowedPaths, no `dirPrefixes`). Multi-file prompts require proper `<file>` tags.
- **Existing docs reuse:** When existing Claude docs are found and strategy is `improve`, reuse is handled as improvement context without a separate loading spinner. Supports cross-target reuse (e.g., existing Claude docs → generate Codex output).
- **Domain reuse helpers:** `loadReusableDomains()` tries `loadReusableDomainsFromRules()` (reads `skill-rules.json` from source target, falls back to `.claude/skills/` for non-Claude targets) first. Falls back to `findSkillFiles()` with `extractKeyFilePatterns()` to derive file patterns from `## Key Files` sections when activation patterns are missing.
- **Target selection:** `--target claude|codex|all` or interactive multiselect if both CLIs available. Stored in `.aspens.json`.
- **Backend routing:** `runLLM()` imported from `runner.js` dispatches to `runClaude()` or `runCodex()` based on `_backendId`. `--backend` flag overrides auto-detection.
- **Content transform (step 11):** Canonical files preserved as originals. Non-Claude targets get `transformForTarget()` applied. If Claude not in target list, canonical files are filtered out of final output.
- **Split writes:** Direct-write files (`.claude/`, `.agents/`, `AGENTS.md`, root `AGENTS.md`) use `writeSkillFiles()`. Directory-scoped files (e.g., `src/billing/AGENTS.md`) use `writeTransformedFiles()` with warn-and-skip policy.
- **Dynamic labels:** `baseArtifactLabel()` and `instructionsArtifactLabel()` return target-appropriate names ("base skill" vs "root AGENTS.md") for spinner messages.
- **Parallel discovery:** Two agents run via `Promise.all` — domain discovery and architecture analysis — before any user prompt.
- **Generation modes:** `all-at-once` = single call; `chunked` = base + per-domain (up to 3 parallel) + instructions file; `base-only` = just base skill; `pick` = interactive domain picker
- **Retry logic:** Base skill and instructions file retry up to 2 times if `parseLLMOutput` returns empty (format correction prompt asking for `<file>` tags).
- **Hook installation:** Only for targets with `supportsHooks: true` (Claude). Generates `skill-rules.json`, copies hook scripts, merges `settings.json`.

## Critical Rules
- **Base skill + instructions file are essential** — pipeline retries automatically with format correction. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — LLM must read existing skills first and not discard human-authored rules.
- **Discovery runs before user prompt** — domain picker shows discovered domains, not scanner directory names. Discovery can be skipped if existing docs are found and user opts to reuse.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent calls. Base skill always sequential first. Instructions file always sequential last.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.
- **`--hooks-only` is Claude-only** — hardcoded to `TARGETS.claude` regardless of config.

## References
- **Prompts:** `src/prompts/doc-init*.md`, `src/prompts/discover-*.md`
- **Partials:** `src/prompts/partials/skill-format.md`, `src/prompts/partials/examples.md`

---
**Last Updated:** 2026-04-07
