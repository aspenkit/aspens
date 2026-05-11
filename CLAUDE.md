# aspens

## Skills

- `.claude/skills/base/skill.md` — Base repo skill; load whenever working in this repo.
- `.claude/skills/agent-customization/skill.md` — LLM-powered injection of project context into installed agent templates via `aspens customize agents`
- `.claude/skills/claude-runner/skill.md` — Claude/Codex CLI execution layer — prompt loading, stream-json parsing, file output extraction, path sanitization, skill file writing, and skill rule generation
- `.claude/skills/cli-shell/skill.md` — Top-level Commander wiring, welcome screen, missing-hook warning, CliError exit handling, and the public programmatic API surface
- `.claude/skills/codex-support/skill.md` — Multi-target output system — target abstraction, backend routing, content transforms for Codex CLI and future targets
- `.claude/skills/doc-impact/skill.md` — Context health analysis — freshness, domain coverage, hub surfacing, drift detection, LLM-powered interpretation, and auto-repair for generated agent context
- `.claude/skills/doc-sync/skill.md` — Incremental skill updater that maps git diffs to affected skills and optionally auto-syncs via a post-commit hook
- `.claude/skills/import-graph/skill.md` — Static import analysis that builds dependency graphs, domain clusters, hub files, git churn hotspots, and file priority rankings
- `.claude/skills/repo-scanning/skill.md` — Deterministic repo analysis — language/framework detection, structure mapping, domain discovery, health checks, and import graph integration
- `.claude/skills/save-tokens/skill.md` — Token-saving session automation — statusline, prompt guard, precompact handoffs, session rotation, and handoff commands for Claude Code
- `.claude/skills/skill-generation/skill.md` — LLM-powered generation pipeline for Claude Code skills and CLAUDE.md — doc-init command, prompt system, context building, and output parsing
- `.claude/skills/template-library/skill.md` — Bundled agents, commands, hooks, and settings that users install via `aspens add`, `aspens doc init`, and `aspens save-tokens` into their .claude/ directories

## Commands

- `npm test` — run Vitest (`vitest run`)
- `npm start` — run the CLI (`node bin/cli.js`)
- `npm run lint` — no-op check (`echo 'No linter configured yet' && exit 0`)
- `aspens scan [path]` — deterministic repo scan
- `aspens doc init [path]` — generate skills, hooks, and instructions file (`--target claude|codex|all`, `--recommended` for full recommended setup including save-tokens, agents, and doc-sync hook)
- `aspens doc impact [path]` — show freshness, coverage, drift, and LLM interpretation of generated context (interactive apply for repairs)
- `aspens doc sync [path]` — update docs from recent diffs
- `aspens doc graph [path]` — rebuild `.claude/graph.json`
- `aspens add <type> [name]` — install bundled templates
- `aspens customize agents` — inject project context into installed agents
- `aspens save-tokens [path]` — install token-saving session settings (`--recommended`, `--remove`)

## Release

- Release workflow: `../dev/release.md`

## Conventions

- ESM only: use `import`/`export`; never `require()`.
- Prefer `CliError` from command handlers; top-level handling lives in `bin/cli.js`.
- `es-module-lexer` must be initialized before `parse()`.
- Keep target/backend semantics straight: target is output format/location; backend is the generating CLI. Persist config in `.aspens.json`.
- Do not duplicate base-skill guidance here; consult `.claude/skills/base/skill.md` for deeper repo context.

## Behavior

- **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
- **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.
- **Ask clarifying questions** — If the task is ambiguous, ask for clarification rather than making assumptions. Don't imply or guess at requirements or constraints that aren't explicitly stated.
- **Simplicity first** — Write the minimum code that solves the problem. No speculative features, abstractions for single-use code, or error handling for impossible scenarios.
- **Surgical changes** — Touch only what the task requires. Don't refactor adjacent code, fix unrelated formatting, or "improve" things that aren't broken.
