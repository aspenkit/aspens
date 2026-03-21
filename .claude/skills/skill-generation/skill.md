---
name: skill-generation
description: LLM-powered generation pipeline for Claude Code skills and CLAUDE.md — doc-init command, prompt system, context building, and output parsing
---

## Activation

This skill triggers when editing skill-generation files:
- `src/commands/doc-init.js`
- `src/commands/doc-sync.js`
- `src/commands/customize.js`
- `src/lib/context-builder.js`
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/prompts/**/*`

---

You are working on **aspens' skill generation pipeline** — the system that scans repos and uses Claude CLI to generate `.claude/skills/` files and `CLAUDE.md`.

## Key Files
- `src/commands/doc-init.js` — Main pipeline: scan → parallel discovery → strategy → mode → generate → write
- `src/lib/runner.js` — `runClaude()` spawns `claude -p --verbose --output-format stream-json`; `loadPrompt()` resolves `{{partial}}` from `src/prompts/partials/`; `parseFileOutput()` extracts `<file path="...">` XML tags
- `src/lib/context-builder.js` — Assembles prompt context from scan results, manifests, configs, domain files, git log
- `src/lib/skill-writer.js` — Writes files with force/skip/overwrite semantics
- `src/prompts/` — Prompt templates; partials in `src/prompts/partials/` are inlined via `{{name}}`

## Key Concepts
- **3-layer pipeline:** (1) `scanRepo` + `buildRepoGraph` (2) parallel discovery agents (domain + architecture via `Promise.all`) (3) generation (all-at-once or chunked)
- **Generation modes:** `all-at-once` = single Claude call for everything; `chunked` = base skill + per-domain (up to 3 parallel via `PARALLEL_LIMIT`) + CLAUDE.md; `base-only` = just base skill
- **Existing docs strategies:** `improve` (preserve hand-written content), `rewrite` (fresh), `skip-existing` (only generate new domains)
- **Auto-timeout:** Scales by repo size category — small=120s, medium=300s, large=600s, very-large=900s
- **Read-only tools:** Claude agents only get `['Read', 'Glob', 'Grep']` — no writes
- **Output format:** Claude returns `<file path="...">content
