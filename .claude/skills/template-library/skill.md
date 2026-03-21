---
name: template-library
description: Bundled agents, commands, and hooks that users install via `aspens add` into their .claude/ directories
---

## Activation

This skill triggers when editing template-library files:
- `src/commands/add.js`
- `src/commands/customize.js`
- `src/templates/**/*`

---

You are working on the **template library** — bundled agents, slash commands, and hooks that users browse and install into their repos.

## Key Files
- `src/commands/add.js` — Core `aspens add <type> [name]` command; copies templates to `.claude/` dirs
- `src/commands/customize.js` — `aspens customize agents` post-install step; uses Claude to inject project context into installed agents
- `src/templates/agents/*.md` — Agent persona templates (9 bundled)
- `src/templates/commands/*.md` — Slash command templates (2 bundled)
- `src/templates/hooks/*.sh` — Hook script templates (2 bundled)

## Key Concepts
- **Three resource types:** `agent` → `.claude/agents`, `command` → `.claude/commands`, `hook` → `.claude/hooks`. Defined in `RESOURCE_TYPES` constant.
- **Template discovery:** `listAvailable()` reads template dir, filters for `.md`/`.sh` files, regex-parses `name:` and `description:` from file content (not proper YAML parsing).
- **Install modes:** Interactive multiselect (no name), by exact name, or `all` for bulk install.
- **No-overwrite policy:** `addResource()` skips files that already exist at the target path via `existsSync` check — never overwrites user-modified files.
- **Customize flow:** Reads CLAUDE.md + skills as context → sends each agent through Claude → writes updated agents back. Only supports `agents` target currently.

## Critical Rules
- Template files **must** contain `name: <value>` and `description: <value>` lines parseable by regex — without these, the template gets a fallback filename-based name and empty description.
- Only `.md` and `.sh` extensions are discovered by `listAvailable()`. Other file types are silently ignored.
- The templates dir resolves from `src/commands/` via `join(__dirname, '..', 'templates')` — moving `add.js` breaks template resolution.
- `customize` requires existing `.claude/agents/` AND either CLAUDE.md or `.claude/skills/` — it exits cleanly if neither exists, telling users to run `doc init` first.
- `customize` uses `writeSkillFiles` with `{ force: true }` to allow writing to `.claude/agents/` paths, bypassing the normal skills-only path restriction.

---
**Last Updated:** 2026-03-21
