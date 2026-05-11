---
name: agent-customization
description: LLM-powered injection of project context into installed agent templates via `aspens customize agents`
triggers:
  files:
    - src/commands/customize.js
    - src/prompts/customize-agents.md
  keywords:
    - customize
    - agents
    - subagent
    - agent customization
---

You are working on **agent customization** — the feature that reads a project's skills and AGENTS.md, then uses Claude CLI to inject project-specific context into generic agent files in `.claude/agents/`.

## Domain purpose
`aspens customize agents` makes generic, bundled agent templates project-aware. It pulls the repo's skills + AGENTS.md as ground truth and asks Claude to add a tech-stack line, 3-5 project conventions, and real commands into each agent — without touching the agent's core logic.

## Business rules / invariants
- **Claude-only feature.** Throws `CliError` for Codex-only repos (`config.targets === ['codex']`). Codex CLI has no agent concept.
- **Base skill is required.** Pre-flight throws `CliError("Run 'aspens doc init' first — base skill is required for agent context.")` if `.agents/skills/base/SKILL.md` is missing.
- **Skills (`.claude/skills/**`) are the single source of truth** for project context. The prompt must not invent other context directories.
- **Read-only tools only.** Claude is invoked with `allowedTools: ['Read', 'Glob', 'Grep']` — no edits/writes from the LLM itself.
- **Output paths restricted to `.claude/`.** `parseFileOutput()` rejects anything else; `writeSkillFiles(..., { force: true })` does the actual write.

## Non-obvious behaviors
- **Frontmatter preservation is split across LLM + code.** The prompt instructs Claude to preserve YAML frontmatter verbatim (including NOT adding a `skills:` line). Then `maybeInjectBaseSkill()` post-processes each returned file to add `skills: [base]` into the frontmatter — this keeps agents valid even when installed via `aspens add agent` without a prior `doc init`.
- **`--reset` semantics:** without `--reset`, agents that already declare `skills:` are left alone; with `--reset`, any existing `skills:` line is overwritten to `skills: [base]`. Used to roll out v0.8 upgrades to previously-customized agents.
- **`## Project context` block is verbatim-preserved** by the prompt — it carries conditional read instructions for code-map / domain skills.
- **AGENTS.md is truncated at 3000 chars** in `gatherProjectContext()`; skills are passed in full.
- **Agent discovery:** `findAgents()` recursively walks `.claude/agents/`, extracts `name:` via regex, falls back to filename if missing.
- **Default timeout 300s** via `resolveTimeout(options.timeout, 300)`; `ASPENS_TIMEOUT` env var honored with warning on invalid value.

## Critical files (purpose, not inventory)
- `src/commands/customize.js` — orchestrator: preflight, agent discovery, context gathering, per-agent Claude calls, post-LLM `skills: [base]` injection, write.
- `src/prompts/customize-agents.md` — system prompt; enforces frontmatter + `## Project context` preservation and bans file-inventory / hub-ranking output.

## Critical Rules
- **Never let the LLM emit a `skills:` line** — the prompt forbids it and the code adds it. If you change one, change both.
- **Never weaken path sanitization** — only `.claude/` paths may be written.
- **Never duplicate file-inventory or hub-ranking output** in customized agents — the graph hook supplies that dynamically.
- **Do not bypass the base-skill preflight** — agents without base context regress to generic behavior.

---
**Last Updated:** 2026-05-11
