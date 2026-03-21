---
name: agent-customization
description: LLM-powered injection of project context into installed agent templates via `aspens customize agents`
---

## Activation

This skill triggers when editing agent-customization files:
- `src/commands/customize.js`
- `src/prompts/customize-agents.md`

---

You are working on **agent customization** — the feature that reads a project's skills and CLAUDE.md, then uses Claude CLI to inject project-specific context into generic agent files in `.claude/agents/`.

## Key Files
- `src/commands/customize.js` — Main command: finds agents, gathers context, calls Claude, writes results
- `src/prompts/customize-agents.md` — System prompt telling Claude how to customize agents
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()` shared across commands
- `src/lib/skill-writer.js` — `writeSkillFiles()` writes parsed output to disk

## Key Concepts
- **Context gathering:** `gatherProjectContext()` reads CLAUDE.md (truncated at 3000 chars), all `.claude/skills/**/*.md`, and lists `.claude/guidelines/` paths without reading their contents.
- **Agent discovery:** `findAgents()` recursively walks `.claude/agents/`, reads `.md` files, extracts the `name:` from YAML frontmatter via regex.
- **Read-only tools:** Claude is invoked with `allowedTools: ['Read', 'Glob', 'Grep']` — no writes allowed during the LLM call.
- **Output parsing:** Claude returns `<file path="...">content</file>` XML tags, parsed by `parseFileOutput()`. Only `.claude/` paths are allowed.

## Critical Rules
- **Read-only tools only** — Claude agents never get write tools. All output goes through `parseFileOutput()` → `writeSkillFiles()`.
- **Context truncation** — CLAUDE.md is capped at 3000 chars to avoid blowing up prompt size. Skills are read in full.
- **Agent frontmatter** — agents must have `name:` in YAML frontmatter or they won't be discovered by `findAgents()`.
- **Path safety** — `parseFileOutput()` only allows writes to `.claude/` prefixed paths. Customized agents stay in `.claude/agents/`.
