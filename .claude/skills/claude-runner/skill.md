---
name: claude-runner
description: Claude/Codex CLI execution layer — prompt loading, stream-json parsing, file output extraction, path sanitization, skill file writing, and skill rule generation
---

## Activation

This skill triggers when editing claude-runner files:
- `src/lib/runner.js`
- `src/lib/skill-writer.js`
- `src/lib/skill-reader.js`
- `src/lib/timeout.js`
- `src/prompts/**/*.md`
- `tests/*extract*`, `tests/*parse*`, `tests/*prompt*`, `tests/*skill-writer*`, `tests/*skill-mapper*`, `tests/*timeout*`

---

You are working on the **CLI execution layer** — the bridge between assembled prompts and the `claude -p` / `codex exec` CLIs, plus skill file I/O.

## Key Files
- `src/lib/runner.js` — `runClaude()`, `runCodex()`, `runLLM()`, `loadPrompt()`, `parseFileOutput()`, `validateSkillFiles()`, `extractResultFromStream()` (exported); `extractResultFromCodexStream()`, `normalizeCodexItemType()`, `collectCodexText()`, `handleStreamEvent()`, `sanitizePath()` (internal)
- `src/lib/skill-writer.js` — `writeSkillFiles()`, `writeTransformedFiles()`, `extractRulesFromSkills()`, `generateDomainPatterns()`, `mergeSettings()`
- `src/lib/skill-reader.js` — `findSkillFiles()`, `parseFrontmatter()`, `parseActivationPatterns()`, `parseKeywords()`, `fileMatchesActivation()`, `getActivationBlock()`, `GENERIC_PATH_SEGMENTS`
- `src/lib/timeout.js` — `resolveTimeout()` — priority: `--timeout` flag > `ASPENS_TIMEOUT` env var > caller fallback
- `src/prompts/` — Markdown prompt templates; `partials/` subdir holds `skill-format.md`, `guideline-format.md`, `examples.md`

## Key Concepts
- **Stream-JSON protocol (Claude):** `runClaude()` always passes `--verbose --output-format stream-json`. Output is NDJSON: `type: 'result'` has final text + usage; `type: 'assistant'` has text/tool_use blocks; `type: 'user'` has tool_result blocks.
- **JSONL protocol (Codex):** `runCodex()` spawns `codex exec --json --sandbox read-only --ask-for-approval never --ephemeral`. Prompt is passed via **stdin** (`'-'` placeholder arg) to avoid shell arg length limits. Stdin write happens **after** event handlers are attached so fast failures are captured. Events: `item.completed`/`item.updated` with normalized types.
- **Unified routing:** `runLLM(prompt, options, backendId)` is the shared entry point — dispatches to `runClaude()` or `runCodex()` based on `backendId`. Exported from `runner.js` so command handlers no longer need local routing helpers.
- **Codex internals (private):** `normalizeCodexItemType()` converts PascalCase/kebab-case to snake_case. `collectCodexText()` recursively extracts text from nested event content. Both are internal to runner.js.
- **Prompt templating:** `loadPrompt(name, vars)` resolves `{{partial-name}}` from `src/prompts/partials/` first, then substitutes `{{varName}}` from `vars`. Target-specific vars (`skillsDir`, `skillFilename`, `instructionsFile`, `configDir`) are passed by command handlers.
- **File output parsing:** Primary: `<file path="...">content</file>` XML tags. Fallback: `<!-- file: path -->` comment markers. `parseFileOutput(output, allowedPaths)` accepts optional `{ dirPrefixes, exactFiles }` to override default allowed paths.
- **Path sanitization:** `sanitizePath(rawPath, allowedPaths)` (internal) blocks `..` traversal, absolute paths. Defaults: `.claude/` prefix + `CLAUDE.md` exact. Multi-target callers pass expanded allowed paths via `getAllowedPaths()` from `target.js`.
- **Validation:** `validateSkillFiles()` checks for truncation (XML tag collisions), missing frontmatter, missing sections, bad file path references.
- **Skill rules generation:** `extractRulesFromSkills()` reads all skills via `skill-reader.js`, produces `skill-rules.json` (v2.0) with file patterns, keywords, and intent patterns.
- **Domain patterns:** `generateDomainPatterns()` converts file patterns to bash `detect_skill_domain()` function using `BEGIN/END` markers.
- **Settings merge:** `mergeSettings()` merges aspens hook config into existing `settings.json`, detecting aspens-managed hooks by `ASPENS_HOOK_MARKERS` (`skill-activation-prompt`, `post-tool-use-tracker`).
- **Directory-scoped writes:** `writeTransformedFiles()` handles files outside `.claude/` (e.g., `src/billing/AGENTS.md`) with explicit path allowlist — only `CLAUDE.md`, `AGENTS.md` exact files and `.claude/`, `.agents/`, `.codex/` prefixes are permitted.
- **`findSkillFiles` matching:** Only matches the exact `skillFilename` (e.g., `skill.md` or `SKILL.md`), not arbitrary `.md` files in the skills directory.

## Critical Rules
- **Both `--verbose` and `--output-format stream-json` are required for Claude** — omitting either breaks stream parsing.
- **Codex uses `--json --sandbox read-only --ask-for-approval never --ephemeral`** — `--sandbox read-only` restricts filesystem access, `--ask-for-approval never` skips prompts, `--ephemeral` avoids persisting conversation. Prompt goes via stdin, not as a CLI arg.
- **Codex stdin write order matters** — event handlers (`stdout`, `stderr`, `close`, `error`) must be attached before writing to stdin, so fast failures are captured.
- **Path sanitization is non-negotiable** — `sanitizePath()` blocks `..` traversal, absolute paths, and any path not in the allowed set.
- **Prompt partials resolve before variables** — `{{skill-format}}` resolves to `partials/skill-format.md` first. If no file, falls through to variable substitution.
- **Timeout resolution:** `resolveTimeout(flagValue, fallbackSeconds)` — `--timeout` flag wins, then `ASPENS_TIMEOUT` env, then caller-provided fallback. Size-based defaults (small: 120s, medium: 300s, large: 600s, very-large: 900s) are set by command handlers, not runner.
- **`mergeSettings` preserves non-aspens hooks** — identifies aspens hooks by `ASPENS_HOOK_MARKERS`, replaces matching entries, preserves everything else.
- **Debug mode:** Set `ASPENS_DEBUG=1` to dump raw stream-json to `$TMPDIR/aspens-debug-stream.json` (Claude) or `$TMPDIR/aspens-debug-codex-stream.json` (Codex). Codex also logs exit code and output length to stderr.

---
**Last Updated:** 2026-04-07
