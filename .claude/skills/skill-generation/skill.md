---
name: skill-generation
description: LLM-powered generation pipeline for Claude Code skills and CLAUDE.md — doc-init command, prompt system, context building, and output parsing
---

## Activation

This skill triggers when editing skill-generation files:
- `src/commands/doc-init.js`
- `src/commands/doc-graph.js`
- `src/lib/context-builder.js`
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/lib/skill-reader.js`
- `src/prompts/**/*`

---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude CLI to generate `.claude/skills/` files, hooks, and `CLAUDE.md`.

## Key Files
- `src/commands/doc-init.js` — Main 9-step pipeline: scan → graph → discovery → strategy → mode → generate → validate → write → hooks
- `src/commands/doc-graph.js` — Standalone graph rebuild command (`aspens doc graph`)
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`
- `src/lib/context-builder.js` — Assembles prompt context from scan results, manifests, configs, domain files, git log
- `src/lib/skill-writer.js` — Writes files, generates `skill-rules.json`, domain bash patterns, merges `settings.json`
- `src/lib/skill-reader.js` — Parses skill frontmatter, activation patterns, keywords (used by skill-writer)
- `src/prompts/` — Prompt templates; `discover-domains.md` and `discover-architecture.md` for discovery agents

## Key Concepts
- **9-step pipeline:** (1) scan + graph (2) parallel discovery agents (3) strategy (4) mode (5) generate (6) validate (7) preview (8) write (9) install hooks
- **Parallel discovery:** Two agents run via `Promise.all` — domain discovery and architecture analysis — before any user prompt
- **Generation modes:** `all-at-once` = single Claude call; `chunked` = base + per-domain (up to 3 parallel via `PARALLEL_LIMIT`) + CLAUDE.md; `base-only` = just base skill
- **`--domains` flag:** Filters which domains to generate in chunked mode; enables `domainsOnly` mode that skips base + CLAUDE.md (for retrying failed domains)
- **`--hooks-only` flag:** Skips generation entirely, just installs/updates hooks from existing skills
- **Retry logic:** Base skill and CLAUDE.md retry up to 2 times if `parseFileOutput` returns empty (format correction prompt)
- **Validation:** `validateSkillFiles()` checks for truncation, missing frontmatter, missing sections, bad file path references
- **Hook installation (step 9):** Generates `skill-rules.json`, copies hook scripts, generates `post-tool-use-tracker.sh` with domain patterns, merges `settings.json`
- **Graph context:** `buildGraphContext()` and `buildDomainGraphContext()` inject import graph data into prompts

## Critical Rules
- **Base skill + CLAUDE.md are essential** — pipeline retries automatically with format correction. Domain skill failures are acceptable (user retries with `--domains`).
- **`improve` strategy preserves hand-written content** — Claude must read existing skills first and not discard human-authored rules.
- **Discovery runs before user prompt** — domain picker shows Claude-discovered domains, not scanner directory names.
- **PARALLEL_LIMIT = 3** — domain skills generate in batches of 3 concurrent Claude calls. Base skill always sequential first. CLAUDE.md always sequential last.
- **Skills must be 35-60 lines** — every line earns its place. No generic advice, no framework documentation.
- **CliError, not process.exit()** — all error exits throw `CliError`; cancellations `return` early.

---
**Last Updated:** 2026-03-24
