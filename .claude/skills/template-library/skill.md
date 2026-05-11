---
name: template-library
description: Bundled agents, commands, hooks, and settings that users install via `aspens add`, `aspens doc init`, and `aspens save-tokens` into their .claude/ directories
triggers:
  files:
    - src/commands/add.js
    - src/prompts/add-skill.md
    - src/templates/**/*
  keywords:
    - template
    - add agent
    - add command
    - add hook
    - add skill
---

You are working on the **template library** — bundled agents, slash commands, hooks, and settings that users browse and install into their repos.

## Domain purpose
`aspens add <type> [name]` copies curated templates into a consumer repo's `.claude/` directories so users get working agents, slash commands, hooks, and settings without authoring them. The same template tree is reused by `aspens doc init` (hook installation, recommended agents) and `aspens save-tokens` (handoff tooling). Custom skills can also be scaffolded blank or LLM-generated from a reference doc.

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
- **Base-skill warning for agents:** `addResource()` prints a non-fatal yellow warning when installing an agent if `.claude/skills/base/skill.md` is missing, prompting the user to run `aspens doc init`. The agent still installs.

## Critical files (purpose, not inventory)
- `src/commands/add.js` — Entry point for `aspens add`; dispatches to resource copy, blank skill scaffold, or LLM skill generation.
- `src/templates/agents/*.md` — Agent persona templates copied as-is into `.claude/agents/`.
- `src/templates/commands/*.md` — Slash command templates (includes handoff commands installed by `save-tokens`).
- `src/templates/hooks/` — Hook scripts (`skill-activation-prompt.{sh,mjs}`, `graph-context-prompt.{sh,mjs}`, `post-tool-use-tracker.sh`, `save-tokens.mjs`, `save-tokens-{statusline,prompt-guard,precompact}.sh`).
- `src/templates/settings/settings.json` — Default Claude Code settings with hook wiring; merged into the consumer repo's settings.
- `src/prompts/add-skill.md` — System prompt for `add skill --from <doc>` LLM generation.

## Critical Rules
- Template files **must** contain `name: <value>` and `description: <value>` lines parseable by regex.
- Only `.md` and `.sh` extensions are discovered by `listAvailable()`. `.mjs` files are copied by `doc init` and `save-tokens` directly, not by `add`.
- The templates dir resolves from `src/commands/` via `join(__dirname, '..', 'templates')` — moving `add.js` breaks template resolution.
- Skill names are sanitized to lowercase alphanumeric + hyphens. Invalid names throw `CliError`.
- Commands throw `CliError` for expected failures instead of calling `process.exit()`.
- Reference docs passed to `add skill --from` are truncated to 50,000 chars before being handed to the LLM.

## References
- **Customize flow:** `.claude/skills/agent-customization/skill.md`
- **Save-tokens install:** `.claude/skills/save-tokens/skill.md`

---
**Last Updated:** 2026-05-11
