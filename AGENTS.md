# aspens

## Skills

- `.agents/skills/doc-sync/SKILL.md` — Incremental skill updater that maps git diffs to affected skills and optionally auto-syncs via a post-commit hook
- `.agents/skills/codex-support/SKILL.md` — Multi-target output system — target abstraction, backend routing, content transforms for Codex CLI and future targets
- `.agents/skills/architecture/SKILL.md` — Import graph and code-map reference for structural changes.

## Commands

- `npm test` — run Vitest (`vitest run`)
- `npm start` — run the CLI (`node bin/cli.js`)
- `npm run lint` — no-op check (`echo 'No linter configured yet' && exit 0`)
- `aspens scan [path]` — deterministic repo scan
- `aspens doc init [path]` — generate skills, hooks, and instructions file (`--target claude|codex|all`, `--recommended` for full recommended setup including save-tokens, agents, and doc-sync hook)
- `aspens doc impact [path]` — show freshness, coverage, drift, and LLM interpretation of generated context (interactive apply for repairs)
- `aspens doc sync [path]` — update docs from recent diffs
- `aspens doc graph [path]` — rebuild `.agents/skills/architecture/references/code-map.md`
- `aspens add <type> [name]` — install bundled templates
- `aspens save-tokens [path]` — install token-saving session settings (`--recommended`, `--remove`)

## Release

- Release workflow: `/Users/MV/aspenkit/dev/release.md`

## Conventions

- ESM only: use `import`/`export`; never `require()`.
- Prefer `CliError` from command handlers; top-level handling lives in `bin/cli.js`.
- `es-module-lexer` must be initialized before `parse()`.
- Keep target/backend semantics straight: target is output format/location; backend is the generating CLI. Persist config in `.aspens.json`.
- Do not duplicate base-skill guidance here; consult `.agents/skills/base/SKILL.md` for deeper repo context.

## Behavior

- **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
- **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.

## Key Files

**Hub files (most depended-on):**
- `src/lib/runner.js` - 9 dependents
- `src/lib/target.js` - 9 dependents
- `src/lib/errors.js` - 8 dependents
- `src/lib/scanner.js` - 8 dependents
- `src/lib/skill-writer.js` - 7 dependents

**Domain clusters:**

| Domain | Files | Top entries |
|--------|-------|-------------|
| src | 45 | `src/commands/doc-init.js`, `src/lib/runner.js`, `src/lib/target.js` |

**High-churn hotspots:**
- `src/commands/doc-init.js` - 35 changes
- `src/commands/doc-sync.js` - 21 changes
- `src/lib/runner.js` - 17 changes

