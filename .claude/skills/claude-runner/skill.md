---
name: claude-runner
description: Claude CLI execution layer — prompt loading, stream-json parsing, file output extraction, path sanitization, and skill file writing
---

## Activation

This skill triggers when editing claude-runner files:
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/prompts/**/*.md`
- `tests/*extract*`, `tests/*parse*`, `tests/*prompt*`, `tests/*skill-writer*`

---

You are working on the **Claude CLI execution layer** — the bridge between assembled prompts and the `claude -p` CLI.

## Key Files
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()`, `extractResultFromStream()`
- `src/lib/skill-writer.js` — `writeSkillFiles()` with dryRun/force/skip semantics
- `src/prompts/` — Markdown prompt templates; `partials/` subdir holds reusable fragments

## Key Concepts
- **Stream-JSON protocol:** `runClaude()` always passes `--verbose --output-format stream-json` (both flags required together with `-p`). Output is NDJSON: `type: 'result'` has final text + cumulative usage; `type: 'assistant'` has text blocks and tool_use blocks; `type: 'user'` has tool_result blocks.
- **Prompt templating:** `loadPrompt(name, vars)` resolves `{{partial-name}}` from `src/prompts/partials/` first, then substitutes `{{varName}}` from `vars`. Partials use lowercase-kebab-case; unresolved partials that aren't in `vars` trigger a console warning.
- **File output parsing:** Primary format is `<file path="...">content</file>` XML tags. Fallback: `<!-- file: path -->` comment markers. Only paths under `.claude/` or exactly `CLAUDE.md` are allowed.

## Critical Rules
- **Both `--verbose` and `--output-format stream-json` are required** — omitting either breaks stream parsing.
- **Path sanitization is non-negotiable** — `sanitizePath()` blocks `..` traversal, absolute paths, and any path not under `.claude/` or exactly `CLAUDE.md`.
- **Prompt partials resolve before variables** — `{{skill-format}}` resolves to `partials/skill-format.md` first. If a partial file doesn't exist, it falls through to variable substitution.
- **Timeout auto-scales** — small: 120s, medium: 300s, large: 600s, very-large: 900s. User `--timeout` overrides.
- **`writeSkillFiles` respects force/skip** — without `--force`, existing files are skipped. Dry-run writes nothing.
