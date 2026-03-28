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

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude CLI to generate `.claude/skills/` files, hooks, and `CLAUDE.md`.

## Key Files
- `src/commands/doc-init.js` — Main 9-step pipeline: scan → graph → discovery → strategy → mode → generate → validate → write → hooks
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`
- `src/lib/skill-writer.js` — Writes files, generates `skill-rules.json`, domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — Parses skill frontmatter, activation patterns, keywords (used by skill-writer)
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync
- `src/lib/timeout.js` — `resolveTimeout()` for auto-scaled + user-override timeouts
- `src/prompts/` — `doc-init.md` (base), `doc-init-domain.md`, `doc-init-claudemd.md`, `discover-domains.md`, `discover-architecture.md`

## Key Concepts
- **9-step pipeline:** (1) scan + graph (2) parallel discovery agents (3) strategy (4) mode (5) generate (6) validate (7) show files + dry-run (8) write (9) install hooks
- **Parallel discovery:** Two agents run via `Promise.all` — domain discovery and architecture analysis — before any user prompt. Uses `buildGraphContextForDiscovery()` (local) for targeted graph context per agent.
- **Generation modes:** `all-at-once` = single Claude call; `chunked` = base + per-domain (up to 3 parallel via `PARALLEL_LIMIT`) + CLAUDE.md; `base-only` = just base skill; `pick` = interactive domain picker (becomes chunked)
- **`--domains` flag:** Filters which domains to generate in chunked mode; combined with `--mode chunked` enables `domainsOnly` mode that skips base + CLAUDE.md (for retrying failed domains)
- **`--hooks-only` flag:** Skips generation entirely, just installs/updates hooks from existing skills
- **`--strategy` flag:** `improve` (read existing, update), `rewrite` (ignore existing), `skip` (only new domains). Interactive prompt if not specified.
- **Retry logic:** Base skill and CLAUDE.md retry up to 2 times if `parseFileOutput` returns empty (format correction prompt asking for `<file>` tags)
- **Validation:** `validateSkillFiles()` checks for truncation, missing frontmatter, missing sections, bad file path references. Truncated files are removed from output.
- **Hook installation (step 9):** Generates `skill-rules.json`, copies hook scripts, generates `post-tool-use-tracker.sh` with domain patterns, merges `settings.json`
- **Local helpers in doc-init.js:** `buildGraphContext()`, `buildDomainGraphContext()`, `buildGraphContextForDiscovery()`, `buildScanSummary()`, `sanitizeInline()`, `tokenTracker`, `autoTimeout()`
- **Token tracking:** `tokenTracker` aggregates prompt/output/tool-use tokens across all Claude calls; displayed with elapsed time at end of pipeline

## Critical Rules
- **Base skill + CLAUDE.md are essential** — pipeline retries automatically with format correction. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — Claude must read existing skills first and not discard human-authored rules.
- **Discovery runs before user prompt** — domain picker shows Claude-discovered domains, not scanner directory names.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent Claude calls. Base skill always sequential first. CLAUDE.md always sequential last.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.

## References
- **Prompts:** `src/prompts/doc-init*.md`, `src/prompts/discover-*.md`
- **Partials:** `src/prompts/partials/skill-format.md`, `src/prompts/partials/examples.md`

---
**Last Updated:** 2026-03-28
