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

Keywords: doc-init, generate skills, discovery agents, chunked generation

---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude/Codex CLI to generate skills, hooks, and instructions files.

## Key Files
- `src/commands/doc-init.js` — Main pipeline: scan → graph → target/backend selection → discovery → strategy → mode → generate → validate → transform → write → hooks → config
- `src/lib/runner.js` — `runClaude()`, `runCodex()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`
- `src/lib/skill-writer.js` — Writes files, generates `skill-rules.json`, domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — Parses skill frontmatter, activation patterns, keywords (used by skill-writer)
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync
- `src/lib/timeout.js` — `resolveTimeout()` for auto-scaled + user-override timeouts
- `src/lib/target.js` — Target definitions, `resolveTarget()`, `writeConfig()`
- `src/lib/backend.js` — Backend detection/resolution (`detectAvailableBackends()`, `resolveBackend()`)
- `src/lib/target-transform.js` — `transformForTarget()` converts Claude output to other target formats
- `src/prompts/` — `doc-init.md` (base), `doc-init-domain.md`, `doc-init-claudemd.md`, `discover-domains.md`, `discover-architecture.md`

## Key Concepts
- **Pipeline steps:** (1) scan + graph (2) target selection (3) backend selection (4) parallel discovery agents (5) strategy (6) mode (7) generate (8) validate (9) transform for additional targets (10) show files + dry-run (11) write (12) install hooks (Claude-only) (13) persist config to `.aspens.json`
- **Target selection:** `--target claude|codex|all` or auto-detect from installed CLIs. Multi-select prompt if both available. Stored in `.aspens.json`.
- **Backend routing:** `runLLM()` local helper dispatches to `runClaude()` or `runCodex()` based on `_backendId`. `--backend` flag overrides auto-detection.
- **Prompt variables:** `targetVars(target)` produces `{ skillsDir, skillFilename, instructionsFile, configDir }` passed to `loadPrompt()` for path substitution in prompt templates.
- **Content transform (step 9):** Generation always produces Claude-target paths. `transformForTarget()` remaps for additional targets. Codex: base skill → root `AGENTS.md`, domain skills → source directory `AGENTS.md` files.
- **Split writes:** Claude-target files use `writeSkillFiles()` (standard `.claude/` paths). Directory-scoped files (e.g., `src/billing/AGENTS.md`) use `writeTransformedFiles()` with warn-and-skip policy.
- **Parallel discovery:** Two agents run via `Promise.all` — domain discovery and architecture analysis — before any user prompt.
- **Generation modes:** `all-at-once` = single call; `chunked` = base + per-domain (up to 3 parallel) + instructions file; `base-only` = just base skill; `pick` = interactive domain picker
- **Retry logic:** Base skill and instructions file retry up to 2 times if `parseFileOutput` returns empty (format correction prompt asking for `<file>` tags)
- **Hook installation:** Only for targets with `supportsHooks: true` (Claude). Generates `skill-rules.json`, copies hook scripts, merges `settings.json`.
- **Existing docs detection:** Checks `hasClaudeConfig`, `hasClaudeMd`, and `hasAgentsMd` from scanner to decide strategy prompt.

## Critical Rules
- **Base skill + instructions file are essential** — pipeline retries automatically with format correction. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — Claude must read existing skills first and not discard human-authored rules.
- **Discovery runs before user prompt** — domain picker shows Claude-discovered domains, not scanner directory names.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent calls. Base skill always sequential first. Instructions file always sequential last.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.
- **`--hooks-only` is Claude-only** — hardcoded to `TARGETS.claude` regardless of config.

## References
- **Prompts:** `src/prompts/doc-init*.md`, `src/prompts/discover-*.md`
- **Partials:** `src/prompts/partials/skill-format.md`, `src/prompts/partials/examples.md`

---
**Last Updated:** 2026-04-02
