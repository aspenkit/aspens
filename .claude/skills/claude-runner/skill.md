---
name: claude-runner
description: Claude CLI execution layer — prompt loading, stream-json parsing, file output extraction, path sanitization, skill file writing, and skill rule generation
---

## Activation

This skill triggers when editing claude-runner files:
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/lib/skill-reader.js`
- `src/prompts/**/*.md`
- `tests/*extract*`, `tests/*parse*`, `tests/*prompt*`, `tests/*skill-writer*`

---

You are working on the **Claude CLI execution layer** — the bridge between assembled prompts and the `claude -p` CLI, plus skill file I/O.

## Key Files
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`, `extractResultFromStream()`
- `src/lib/skill-writer.js` — `writeSkillFiles()`, `extractRulesFromSkills()`, `generateDomainPatterns()`, `mergeSettings()`
- `src/lib/skill-reader.js` — `findSkillFiles()`, `parseFrontmatter()`, `parseActivationPatterns()`, `parseKeywords()`
- `src/prompts/` — Markdown prompt templates; `partials/` subdir holds reusable fragments

## Key Concepts
- **Stream-JSON protocol:** `runClaude()` always passes `--verbose --output-format stream-json`. Output is NDJSON: `type: 'result'` has final text + usage; `type: 'assistant'` has text/tool_use blocks; `type: 'user'` has tool_result blocks.
- **Prompt templating:** `loadPrompt(name, vars)` resolves `{{partial-name}}` from `src/prompts/partials/` first, then substitutes `{{varName}}` from `vars`.
- **File output parsing:** Primary: `<file path="...">content</file>` XML tags. Fallback: `<!-- file: path -->` comment markers. Handles code fences correctly.
- **Validation:** `validateSkillFiles()` checks for truncation (XML tag collisions), missing frontmatter, missing sections, bad file path references.
- **Skill rules generation:** `extractRulesFromSkills()` reads all skills via `skill-reader.js`, produces `skill-rules.json` (v2.0) with file patterns, keywords, and intent patterns.
- **Domain patterns:** `generateDomainPatterns()` converts file patterns to bash `detect_skill_domain()` function using `BEGIN/END` markers.
- **Settings merge:** `mergeSettings()` merges aspens hook config into existing `settings.json`, detecting aspens-managed hooks by command path markers.

## Critical Rules
- **Both `--verbose` and `--output-format stream-json` are required** — omitting either breaks stream parsing.
- **Path sanitization is non-negotiable** — `sanitizePath()` blocks `..` traversal, absolute paths, and any path not under `.claude/` or exactly `CLAUDE.md`.
- **Prompt partials resolve before variables** — `{{skill-format}}` resolves to `partials/skill-format.md` first. If no file, falls through to variable substitution.
- **Timeout auto-scales** — small: 120s, medium: 300s, large: 600s, very-large: 900s. User `--timeout` overrides.
- **`mergeSettings` preserves non-aspens hooks** — identifies aspens hooks by `ASPENS_HOOK_MARKERS` (`skill-activation-prompt`, `post-tool-use-tracker`), replaces matching entries, preserves everything else.

---
**Last Updated:** 2026-03-24
