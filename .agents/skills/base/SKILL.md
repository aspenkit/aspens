---
name: base
description: Core conventions, tech stack, and project structure for aspens
triggers:
  alwaysActivate: true
---

You are working in **aspens** — a CLI that keeps coding-agent context accurate as your codebase changes. Scans repos, generates project-specific instructions and skills for Claude Code and Codex CLI, and keeps them fresh.

## Tech Stack
Node.js 20+ (ESM) | Commander | Vitest | es-module-lexer | @clack/prompts | picocolors

## Commands
- `npm test` — Run vitest suite
- `npm start` / `node bin/cli.js` — Run CLI
- `aspens scan [path]` — Deterministic repo analysis (no LLM)
- `aspens doc init [path]` — Generate skills + hooks + AGENTS.md (`--target claude|codex|all`, `--recommended` for full recommended setup)
- `aspens doc impact [path]` — Show freshness, coverage, and drift of generated context (`--apply` for auto-repair, `--backend`/`--model`/`--timeout`/`--verbose` for LLM interpretation)
- `aspens doc sync [path]` — Incremental skill updates from git diffs
- `aspens doc graph [path]` — Rebuild import graph cache (`.claude/graph.json`)
- `aspens add <type> [name]` — Install templates (agents, commands, hooks)
- `aspens customize agents` — Inject project context into installed agents
- `aspens save-tokens [path]` — Install token-saving session settings (`--recommended` for no-prompt install, `--remove` to uninstall)
- **Debug:** `ASPENS_DEBUG=1` dumps raw stream events to `$TMPDIR/aspens-debug-{stream,codex-stream}.json`
- **Env knob:** `ASPENS_TIMEOUT` (seconds) overrides default LLM timeout when `--timeout` not passed

## Architecture
CLI entry (`bin/cli.js`) → command handlers (`src/commands/`) → lib modules (`src/lib/`)

- `src/lib/scanner.js` — Deterministic repo scanner (languages, frameworks, domains, structure)
- `src/lib/graph-builder.js` — Static import analysis via es-module-lexer (hub files, clusters, priority)
- `src/lib/graph-persistence.js` — Graph serialization, subgraph extraction, code-map + index generation
- `src/lib/runner.js` — Claude/Codex CLI wrapper (`runClaude` for stream-json, `runCodex` for Codex JSONL); also hosts `loadPrompt` (partial substitution) and `parseFileOutput`/`validateSkillFiles`
- `src/lib/context-builder.js` — Assembles repo files into prompt-friendly context
- `src/lib/skill-writer.js` — Writes skill files and directory-scoped files, generates skill-rules.json, merges settings
- `src/lib/skill-reader.js` — Parses skill files, frontmatter, `triggers:` blocks, legacy activation patterns, keywords
- `src/lib/diff-classifier.js` — Maps changed files to affected skills for doc-sync
- `src/lib/diff-helpers.js` — Targeted file diffs and prioritized diff truncation for doc-sync
- `src/lib/git-helpers.js` — Git repo detection, git root resolution, diff retrieval, log formatting
- `src/lib/git-hook.js` — Post-commit git hook installation/removal for auto doc-sync (monorepo-aware)
- `src/lib/impact.js` — Context health analysis: domain coverage, hub surfacing, drift detection, hook health, save-tokens health, usefulness summary, value comparison, opportunities
- `src/lib/save-tokens.js` — Save-tokens config defaults, settings builders, gitignore/readme generators
- `src/lib/timeout.js` — Timeout resolution (`--timeout` flag > `ASPENS_TIMEOUT` env > default)
- `src/lib/errors.js` — `CliError` class (structured errors caught by CLI top-level handler)
- `src/lib/target.js` — Target definitions (claude/codex), config persistence (`.aspens.json`) with `saveTokens` feature config; `getAllowedPaths` for multi-target sanitization
- `src/lib/target-transform.js` — Transforms Claude-format output to other target formats
- `src/lib/backend.js` — Backend detection and resolution (which CLI generates content)
- `src/lib/path-resolver.js` / `src/lib/source-exts.js` — Source-file extension and path resolution helpers shared by scanner/graph
- `src/lib/parsers/` — Language-specific import parsers (TypeScript, Python)
- `src/lib/frameworks/` — Framework-specific detectors (e.g. Next.js)
- `src/prompts/` — Prompt templates with `{{partial}}` and `{{variable}}` substitution
- `src/templates/` — Bundled agents, commands, hooks, and settings for `aspens add` / `doc init` / `save-tokens`

## Critical Conventions
- **Pure ESM** — `"type": "module"` throughout; use `import`/`export`, never `require()`
- **es-module-lexer WASM** — must `await init` before calling `parse()` in graph-builder
- **Claude CLI execution** — `runClaude()` spawns `claude -p` with stream-json; always use `--verbose` flag with stream-json
- **Codex CLI execution** — `runCodex()` spawns `codex exec --json --sandbox read-only --ask-for-approval never --ephemeral`; returns `{ text, usage }` matching `runClaude` interface
- **Stdin with backpressure** — `runClaude`/`runCodex` pipe prompts via stdin and respect `drain` when `write()` returns false; never rewrite to use args (shell length limits)
- **Path sanitization** — `parseFileOutput()` restricts writes to `.claude/` and `AGENTS.md` by default; accepts `allowedPaths` override for multi-target via `getAllowedPaths(targets)`
- **Read-only LLM tools** — customize-style commands pass `allowedTools: ['Read', 'Glob', 'Grep']`; never broaden without review
- **Prompt partials** — `{{name}}` in prompt files resolves to `src/prompts/partials/name.md` first, then falls back to template variables
- **Target/Backend distinction** — Target = output format/location; Backend = which LLM CLI generates content. Config persisted in `.aspens.json`. Customize is Claude-only (`CliError` if `targets: ['codex']`)
- **Scanner is deterministic** — no LLM calls; pure filesystem analysis
- **CliError pattern** — command handlers throw `CliError` instead of calling `process.exit()`; caught at top level in `bin/cli.js`
- **Monorepo support** — `getGitRoot()` resolves the actual git root; hooks, sync, and impact scope to the subdirectory project path
- **Verify before claiming** — Never state something is configured/running/done without confirming in-session

## Structure
- `bin/` — CLI entry point (commander setup, CliError handler)
- `src/commands/` — Command handlers (scan, doc-init, doc-impact, doc-sync, doc-graph, add, customize, save-tokens)
- `src/lib/` — Core library modules
- `src/prompts/` — Prompt templates + partials
- `src/templates/` — Installable agents, commands, hooks, settings
- `tests/` — Vitest test files

---
**Last Updated:** 2026-05-11
