---
name: base
description: Core conventions, tech stack, and project structure for aspens
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

You are working in **aspens** — a CLI that keeps coding-agent context accurate as your codebase changes. Scans repos, generates project-specific instructions and skills for Claude Code and Codex CLI, and keeps them fresh.

## Tech Stack
Node.js (ESM) | Commander | Vitest | es-module-lexer | @clack/prompts | picocolors

## Commands
- `npm test` — Run vitest suite
- `npm start` / `node bin/cli.js` — Run CLI
- `aspens scan [path]` — Deterministic repo analysis (no LLM)
- `aspens doc init [path]` — Generate skills + hooks + CLAUDE.md (`--target claude|codex|all`, `--recommended` for smart defaults)
- `aspens doc impact [path]` — Show freshness, coverage, and drift of generated context (`--apply` for auto-repair, `--backend`/`--model`/`--timeout`/`--verbose` for LLM interpretation)
- `aspens doc sync [path]` — Incremental skill updates from git diffs
- `aspens doc graph [path]` — Rebuild import graph cache (`.claude/graph.json`)
- `aspens add <type> [name]` — Install templates (agents, commands, hooks)
- `aspens customize agents` — Inject project context into installed agents

## Architecture
CLI entry (`bin/cli.js`) → command handlers (`src/commands/`) → lib modules (`src/lib/`)

- `src/lib/scanner.js` — Deterministic repo scanner (languages, frameworks, domains, structure)
- `src/lib/graph-builder.js` — Static import analysis via es-module-lexer (hub files, clusters, priority)
- `src/lib/graph-persistence.js` — Graph serialization, subgraph extraction, code-map + index generation
- `src/lib/runner.js` — Claude/Codex CLI wrapper (`runClaude` for stream-json, `runCodex` for Codex JSONL)
- `src/lib/context-builder.js` — Assembles repo files into prompt-friendly context
- `src/lib/skill-writer.js` — Writes skill files and directory-scoped files, generates skill-rules.json, merges settings
- `src/lib/skill-reader.js` — Parses skill files, frontmatter, activation patterns, keywords
- `src/lib/diff-helpers.js` — Targeted file diffs and prioritized diff truncation for doc-sync
- `src/lib/git-helpers.js` — Git repo detection, git root resolution, diff retrieval, log formatting
- `src/lib/git-hook.js` — Post-commit git hook installation/removal for auto doc-sync (monorepo-aware)
- `src/lib/impact.js` — Context health analysis: domain coverage, hub surfacing, drift detection, hook health evaluation, usefulness summary, value comparison
- `src/lib/timeout.js` — Timeout resolution (`--timeout` flag > `ASPENS_TIMEOUT` env > default)
- `src/lib/errors.js` — `CliError` class (structured errors caught by CLI top-level handler)
- `src/lib/target.js` — Target definitions (claude/codex), config persistence (`.aspens.json`)
- `src/lib/target-transform.js` — Transforms Claude-format output to other target formats
- `src/lib/backend.js` — Backend detection and resolution (which CLI generates content)
- `src/prompts/` — Prompt templates with `{{partial}}` and `{{variable}}` substitution
- `src/templates/` — Bundled agents, commands, hooks, and settings for `aspens add` / `doc init`

## Critical Conventions
- **Pure ESM** — `"type": "module"` throughout; use `import`/`export`, never `require()`
- **es-module-lexer WASM** — must `await init` before calling `parse()` in graph-builder
- **Claude CLI execution** — `runClaude()` spawns `claude -p` with stream-json; always use `--verbose` flag with stream-json
- **Codex CLI execution** — `runCodex()` spawns `codex exec --json --sandbox read-only --ask-for-approval never --ephemeral`; returns `{ text, usage }` matching `runClaude` interface
- **Path sanitization** — `parseFileOutput()` restricts writes to `.claude/` and `CLAUDE.md` by default; accepts `allowedPaths` override for multi-target
- **Prompt partials** — `{{name}}` in prompt files resolves to `src/prompts/partials/name.md` first, then falls back to template variables
- **Target/Backend distinction** — Target = output format/location; Backend = which LLM CLI generates content. Config persisted in `.aspens.json`
- **Scanner is deterministic** — no LLM calls; pure filesystem analysis
- **CliError pattern** — command handlers throw `CliError` instead of calling `process.exit()`; caught at top level in `bin/cli.js`
- **Monorepo support** — `getGitRoot()` resolves the actual git root; hooks, sync, and impact scope to the subdirectory project path

## Structure
- `bin/` — CLI entry point (commander setup, CliError handler)
- `src/commands/` — Command handlers (scan, doc-init, doc-impact, doc-sync, doc-graph, add, customize)
- `src/lib/` — Core library modules
- `src/prompts/` — Prompt templates + partials
- `src/templates/` — Installable agents, commands, hooks, settings
- `tests/` — Vitest test files

---
**Last Updated:** 2026-04-08
