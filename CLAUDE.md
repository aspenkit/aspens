# aspens

CLI for keeping coding-agent context accurate as your codebase changes. Supports Claude Code and Codex CLI. Stack: Node.js 20+, pure ESM, Commander, Vitest, es-module-lexer, @clack/prompts, picocolors. Entry point: `src/index.js` and CLI at `bin/cli.js`.

## Skills

- `.claude/skills/base/skill.md` — Base repo skill; load whenever working in this repo. Use it for project structure, architecture notes, and repo-specific conventions.

## Commands

- `npm test` — run Vitest (`vitest run`)
- `npm start` — run the CLI (`node bin/cli.js`)
- `npm run lint` — no-op check (`echo 'No linter configured yet' && exit 0`)
- `aspens scan [path]` — deterministic repo scan
- `aspens doc init [path]` — generate skills, hooks, and instructions file (`--target claude|codex|all`, `--recommended` for smart defaults)
- `aspens doc impact [path]` — show freshness, coverage, drift, and LLM interpretation of generated context (interactive apply for repairs)
- `aspens doc sync [path]` — update docs from recent diffs
- `aspens doc graph [path]` — rebuild `.claude/graph.json`
- `aspens add <type> [name]` — install bundled templates
- `aspens customize agents` — inject project context into installed agents

## Release

- Release workflow: `/Users/MV/aspenkit/dev/release.md`

## Conventions

- ESM only: use `import`/`export`; never `require()`.
- Prefer `CliError` from command handlers; top-level handling lives in `bin/cli.js`.
- `es-module-lexer` must be initialized before `parse()`.
- Keep target/backend semantics straight: target is output format/location; backend is the generating CLI. Persist config in `.aspens.json`.
- Do not duplicate base-skill guidance here; consult `.claude/skills/base/skill.md` for deeper repo context.

## Behavior

- **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
- **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.
