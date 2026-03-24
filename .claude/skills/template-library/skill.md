---
name: template-library
description: Bundled agents, commands, hooks, and settings that users install via `aspens add` and `aspens doc init` into their .claude/ directories
---

## Activation

This skill triggers when editing template-library files:
- `src/commands/add.js`
- `src/commands/customize.js`
- `src/templates/**/*`

---

You are working on the **template library** — bundled agents, slash commands, hooks, and settings that users browse and install into their repos.

## Key Files
- `src/commands/add.js` — Core `aspens add <type> [name]` command; copies templates to `.claude/` dirs
- `src/commands/customize.js` — `aspens customize agents` post-install step; uses Claude to inject project context
- `src/templates/agents/*.md` — Agent persona templates (9 bundled)
- `src/templates/commands/*.md` — Slash command templates (2 bundled)
- `src/templates/hooks/` — Hook scripts (5 bundled): `skill-activation-prompt.sh/mjs`, `graph-context-prompt.sh/mjs`, `post-tool-use-tracker.sh`
- `src/templates/settings/settings.json` — Default settings with hook configuration

## Key Concepts
- **Four resource types for `add`:** `agent` → `.claude/agents`, `command` → `.claude/commands`, `hook` → `.claude/hooks`. Settings installed automatically by `doc init`.
- **Hook templates:** `skill-activation-prompt` reads `skill-rules.json` and injects relevant skills into prompts. `graph-context-prompt` loads graph data for code navigation. `post-tool-use-tracker` detects skill domains from file access patterns.
- **`doc init` hook installation (step 9):** Generates `skill-rules.json` from skills, copies hook files, generates `post-tool-use-tracker.sh` with domain patterns (via `BEGIN/END` markers), merges `settings.json` with backup.
- **Template discovery:** `listAvailable()` reads template dir, filters `.md`/`.sh` files, regex-parses `name:` and `description:`.
- **No-overwrite policy:** `addResource()` skips files that already exist via `existsSync` check.
- **Customize flow:** Reads CLAUDE.md + skills as context → sends each agent through Claude → writes updated agents back. Only supports `agents` target.

## Critical Rules
- Template files **must** contain `name: <value>` and `description: <value>` lines parseable by regex.
- Only `.md` and `.sh` extensions are discovered by `listAvailable()`. `.mjs` files are copied by `doc init` directly, not by `add`.
- The templates dir resolves from `src/commands/` via `join(__dirname, '..', 'templates')` — moving `add.js` breaks template resolution.
- `customize` requires `.claude/agents/` AND either CLAUDE.md or `.claude/skills/` — exits cleanly otherwise.
- Commands throw `CliError` for expected failures instead of calling `process.exit()`.

---
**Last Updated:** 2026-03-24
