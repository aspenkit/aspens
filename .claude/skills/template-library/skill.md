---
name: template-library
description: Bundled agents, commands, hooks, and settings that users install via `aspens add` and `aspens doc init` into their .claude/ directories
---

## Activation

This skill triggers when editing template-library files:
- `src/commands/add.js`
- `src/templates/**/*`

Keywords: template, add agent, add command, add hook, add skill

---

You are working on the **template library** — bundled agents, slash commands, hooks, and settings that users browse and install into their repos.

## Key Files
- `src/commands/add.js` — Core `aspens add <type> [name]` command; copies templates to `.claude/` dirs, scaffolds/generates custom skills
- `src/templates/agents/*.md` — Agent persona templates (11 bundled)
- `src/templates/commands/*.md` — Slash command templates (2 bundled)
- `src/templates/hooks/` — Hook scripts (5 bundled): `skill-activation-prompt.sh/mjs`, `graph-context-prompt.sh/mjs`, `post-tool-use-tracker.sh`
- `src/templates/settings/settings.json` — Default settings with hook configuration
- `src/prompts/add-skill.md` — System prompt for LLM-powered skill generation from reference docs

## Key Concepts
- **Four resource types for `add`:** `agent` → `.claude/agents`, `command` → `.claude/commands`, `hook` → `.claude/hooks`. A fourth type `skill` is handled separately (not template-based).
- **Codex-only restriction:** `add agent`, `add command`, and `add hook` throw `CliError` for Codex-only repos (checked via `readConfig()`). Skills work with both targets — `add skill` is always available.
- **Skill subcommand:** `aspens add skill <name>` scaffolds a blank skill template. `--from <file>` generates a skill from a reference doc using Claude (LLM-powered). `--list` shows installed skills.
- **Hook templates:** `skill-activation-prompt` reads `skill-rules.json` and injects relevant skills into prompts. `graph-context-prompt` loads graph data for code navigation. `post-tool-use-tracker` detects skill domains from file access patterns.
- **`doc init` hook installation (step 9):** Generates `skill-rules.json` from skills, copies hook files, generates `post-tool-use-tracker.sh` with domain patterns (via `BEGIN/END` markers), merges `settings.json` with backup.
- **Template discovery:** `listAvailable()` reads template dir, filters `.md`/`.sh` files, regex-parses `name:` and `description:`.
- **No-overwrite policy:** `addResource()` skips files that already exist via `existsSync` check. Same for `addSkillCommand`.
- **Plan/execute gitignore:** Adding `plan` or `execute` agents auto-adds `dev/` to `.gitignore` for plan storage.

## Critical Rules
- Template files **must** contain `name: <value>` and `description: <value>` lines parseable by regex.
- Only `.md` and `.sh` extensions are discovered by `listAvailable()`. `.mjs` files are copied by `doc init` directly, not by `add`.
- The templates dir resolves from `src/commands/` via `join(__dirname, '..', 'templates')` — moving `add.js` breaks template resolution.
- Skill names are sanitized to lowercase alphanumeric + hyphens. Invalid names throw `CliError`.
- Commands throw `CliError` for expected failures instead of calling `process.exit()`.

## References
- **Customize flow:** `.claude/skills/agent-customization/skill.md`

---
**Last Updated:** 2026-04-02
