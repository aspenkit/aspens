---
name: cli-shell
description: Top-level Commander wiring, welcome screen, missing-hook warning, CliError exit handling, and the public programmatic API surface
triggers:
  files:
    - bin/cli.js
    - src/index.js
    - src/lib/errors.js
  keywords:
    - CliError
    - commander
    - bin/cli.js
    - welcome
    - checkMissingHooks
    - parsePositiveInt
    - parseTimeout
    - SIGINT
    - SIGTERM
    - aspens public api
---

You are working on the **CLI shell** — the entry point that wires Commander subcommands, prints the welcome screen, warns about missing Claude hooks, dispatches to handlers, and translates `CliError` into a clean exit. Also the public programmatic surface re-exported from `src/index.js`.

## Domain purpose
This layer is what a user actually invokes (`aspens …`) and what programmatic consumers import. It owns argument parsing, top-level error handling, and the welcome UX. All real work lives in `src/commands/*.js` — the shell only routes.

## Business rules / invariants
- **Handlers must throw `CliError`, never call `process.exit()`.** The top-level handler in `bin/cli.js:250` catches it, prints `Error: <message>` (unless `logged: true`) in red, and exits with `err.exitCode` (default 1). Plain `Error` falls through to the same printer but always exits 1.
- **`logged: true` means "I already printed a user-friendly message"** — top level then exits silently with the given code. Use it when the handler rendered a clack `outro` or multi-line failure already.
- **`checkMissingHooks(repoPath)` runs before `doc sync`, `add`, and `customize`** — warns (does not throw) when `.claude/skills/` exists but `.claude/hooks/skill-activation-prompt.sh` or `.claude/skills/skill-rules.json` is absent. Skipped entirely when `.claude/skills/` is missing (nothing to activate).
- **No-command invocation shows `showWelcome()`** — listing essential commands, generate/sync, Claude add-ons, utilities, options, typical workflow, and target notes. Adding a new subcommand requires updating this screen too.
- **Template counts in the welcome are filesystem-derived** — `countTemplates(subdir)` reads `src/templates/{agents,commands,hooks}` and filters dotfiles; returns `'?'` on read failure (never throws).
- **Version comes from `package.json`** at runtime via `readFileSync`; falls back to `'0.0.0'` silently if parse/read fails. Do not hardcode.
- **Numeric option parsers throw `InvalidArgumentError`** (Commander-native) — `parsePositiveInt` rejects ≤0/NaN; `parseCommits` additionally caps at 50.
- **Signal handlers exit with conventional codes** — SIGINT→130, SIGTERM→143. Used to clean up spawned `claude -p` / `codex exec` children.

## Non-obvious behaviors
- **Action wrappers chain `checkMissingHooks` before the handler** for `doc sync`, `add`, `customize` — done inline via arrow `(args, options) => { checkMissingHooks(resolve(path)); return handler(...) }`. Don't move this into the handler — the warning should fire even if the handler later fails or short-circuits.
- **`program.parseAsync()` is required** (not `.parse()`) — handlers are async; `.catch()` on the returned promise is the only place plain errors are surfaced.
- **`src/index.js` is the public programmatic API** — only re-exports `scanRepo`, `runClaude`, `loadPrompt`, `parseFileOutput`, `writeSkillFiles`, `buildContext`, `buildBaseContext`, `buildDomainContext`, `analyzeImpact`. Adding/removing a re-export is a breaking change for embedders; treat it as such.

## Critical files
- `bin/cli.js` — Commander setup, option parsers, welcome screen, signal handlers, top-level `CliError` catch.
- `src/lib/errors.js` — `CliError` class with `exitCode` and `logged` options (plus optional `cause`).
- `src/index.js` — Stable programmatic surface for library consumers.

## Critical Rules
- New subcommand → register on `program` (or the `doc` subgroup) **and** add it to `showWelcome()` so users discover it.
- Never swallow a handler error in the action wrapper — let it bubble to `program.parseAsync().catch()`.
- When a handler renders its own failure UX (clack/picocolors), throw `new CliError(msg, { logged: true, exitCode })` so the top level does not double-print.

---
**Last Updated:** 2026-05-11
