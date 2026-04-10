---
name: template-library
description: Bundled agents, commands, hooks, and settings that users install via `aspens add`, `aspens doc init`, and `aspens save-tokens` into their .claude/ directories
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
- `src/templates/commands/*.md` — Slash command templates (5 bundled: save-handoff, resume-handoff, resume-handoff-latest, plus 2 original)
- `src/templates/hooks/` — Hook scripts: `skill-activation-prompt.sh/mjs`, `graph-context-prompt.sh/mjs`, `post-tool-use-tracker.sh`, `save-tokens.mjs`, `save-tokens-statusline.sh`, `save-tokens-prompt-guard.sh`, `save-tokens-precompact.sh`
- `src/templates/settings/settings.json` — Default settings with hook configuration (commands are double-quoted for shell safety)
- `src/prompts/add-skill.md` — System prompt for LLM-powered skill generation from reference docs

## Key Concepts
- **Four resource types for `add`:** `agent` → `.claude/agents`, `command` → `.claude/commands`, `hook` → `.claude/hooks`. A fourth type `skill` is handled separately (not template-based).
- **Save-tokens templates:** `save-tokens.mjs` is the runtime entry point for all three hook entry points (statusline, prompt-guard, precompact). Shell wrappers (`save-tokens-*.sh`) resolve project dir and delegate to the `.mjs` file. Slash commands (`save-handoff.md`, `resume-handoff.md`, `resume-handoff-latest.md`) provide user-invokable handoff management. These are installed by `aspens save-tokens` or `aspens doc init --recommended`, not by `aspens add`.
- **Codex-only restriction:** `add agent`, `add command`, and `add hook` throw `CliError` for Codex-only repos. Skills work with both targets.
- **Target-aware skill commands:** `addSkillCommand` and `generateSkillFromDoc` resolve the active target via `resolveSkillTarget(config)`. Skill paths use `target.skillsDir` and `target.skillFilename`.
- **Backend-aware generation:** `generateSkillFromDoc` uses `runLLM()` to dispatch to Claude or Codex based on config.
- **Hook templates (monorepo-aware):** Shell hooks compute `PROJECT_DIR` from the script's own location (`cd "$SCRIPT_DIR/../.." && pwd`) and pass it as `ASPENS_PROJECT_DIR` to `.mjs` counterparts. Save-tokens shell hooks follow the same pattern.
- **Settings template quoting:** Hook commands in `settings.json` are wrapped in double quotes for shell safety.
- **`doc init` hook installation (step 13):** Generates `skill-rules.json`, copies hook files, generates `post-tool-use-tracker.sh` with domain patterns, merges `settings.json` with backup.
- **`doc init --recommended` extras (step 15):** Copies all bundled agent templates to `.claude/agents/` (skips existing), adds `dev/` to `.gitignore`.
- **Template discovery:** `listAvailable()` reads template dir, filters `.md`/`.sh` files, regex-parses `name:` and `description:`.
- **No-overwrite policy:** `addResource()` skips files that already exist. Same for `addSkillCommand`.
- **Plan/execute gitignore:** Adding `plan` or `execute` agents auto-adds `dev/` to `.gitignore` for plan storage. `doc init --recommended` also ensures `dev/` in `.gitignore`.

## Critical Rules
- Template files **must** contain `name: <value>` and `description: <value>` lines parseable by regex.
- Only `.md` and `.sh` extensions are discovered by `listAvailable()`. `.mjs` files are copied by `doc init` and `save-tokens` directly, not by `add`.
- The templates dir resolves from `src/commands/` via `join(__dirname, '..', 'templates')` — moving `add.js` breaks template resolution.
- Skill names are sanitized to lowercase alphanumeric + hyphens. Invalid names throw `CliError`.
- Commands throw `CliError` for expected failures instead of calling `process.exit()`.

## References
- **Customize flow:** `.claude/skills/agent-customization/skill.md`
- **Save-tokens install:** `.claude/skills/save-tokens/skill.md`

---
**Last Updated:** 2026-04-09
