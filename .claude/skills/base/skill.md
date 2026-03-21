---
name: base
description: Core conventions, tech stack, and project structure for aspens
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

You are working in **aspens** — a CLI tool that generates and maintains AI-ready documentation (skill files + CLAUDE.md) for any codebase.

## Tech Stack
Node.js (ESM) | Commander | Vitest | es-module-lexer | @clack/prompts | picocolors

## Commands
- `npm test` — Run vitest suite
- `npm start` / `node bin/cli.js` — Run CLI
- `aspens scan [path]` — Deterministic repo analysis (no LLM)
- `aspens doc init [path]` — Generate skills via Claude CLI
- `aspens doc sync [path]` — Incremental skill updates from git diffs
- `aspens add <type> [name]` — Install templates (agents, commands, hooks)
- `aspens customize agents` — Inject project context into installed agents

## Architecture
CLI entry (`bin/cli.js`) → command handlers (`src/commands/`) → lib modules (`src/lib/`)

- `src/lib/scanner.js` — Deterministic repo scanner (languages, frameworks, domains, structure)
- `src/lib/graph-builder.js` — Static import analysis via es-module-lexer (hub files, clusters, priority)
- `src/lib/runner.js` — Claude CLI wrapper (`claude -p --output-format stream-json`)
- `src/lib/context-builder.js` — Assembles repo files into prompt-friendly context
- `src/lib/skill-writer.js` — Writes parsed `<file>` output to disk
- `src/prompts/` — Prompt templates with `{{partial}}` and `{{variable}}` substitution
- `src/templates/` — Bundled agents, commands, and hooks for `aspens add`

## Critical Conventions
- **Pure ESM** — `"type": "module"` throughout; use `import`/`export`, never `require()`
- **es-module-lexer WASM** — must `await init` before calling `parse()` in graph-builder
- **Claude CLI execution** — `runClaude()` spawns `claude -p` with stream-json; always use `--verbose` flag with stream-json
- **Path sanitization** — `parseFileOutput()` restricts writes to `.claude/` and `CLAUDE.md` only; no absolute paths or `..` traversal
- **Prompt partials** — `{{name}}` in prompt files resolves to `src/prompts/partials/name.md` first, then falls back to template variables
- **Scanner is deterministic** — no LLM calls; pure filesystem analysis

## Structure
- `bin/` — CLI entry point (commander setup)
- `src/commands/` — Command handlers (scan, doc-init, doc-sync, add, customize)
- `src/lib/` — Core library modules
- `src/prompts/` — Prompt templates + partials
- `src/templates/` — Installable agents, commands, hooks
- `tests/` — Vitest test files

---
**Last Updated:** 2026-03-21
