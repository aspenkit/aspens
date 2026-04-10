---
name: save-tokens
description: Token-saving session automation — statusline, prompt guard, precompact handoffs, session rotation, and handoff commands for Claude Code
---

## Activation

This skill triggers when editing save-tokens files:
- `src/commands/save-tokens.js`
- `src/lib/save-tokens.js`
- `src/templates/hooks/save-tokens*.sh`
- `src/templates/hooks/save-tokens.mjs`
- `src/templates/commands/save-handoff.md`
- `src/templates/commands/resume-handoff*.md`
- `tests/save-tokens*.test.js`

Keywords: save-tokens, handoff, statusline, prompt-guard, precompact, session rotation, token warning

---

You are working on **save-tokens** — the feature that installs Claude Code hooks and commands to warn about token usage, auto-save handoffs before compaction, and support session rotation.

## Key Files
- `src/commands/save-tokens.js` — Main command: interactive or `--recommended` install, `--remove` uninstall, installs hooks + commands + settings
- `src/lib/save-tokens.js` — Config defaults (`DEFAULT_SAVE_TOKENS_CONFIG`), `buildSaveTokensConfig()`, `buildSaveTokensSettings()`, `buildSaveTokensGitignore()`, `buildSaveTokensReadme()`
- `src/templates/hooks/save-tokens.mjs` — Runtime hook: `runStatusline()`, `runPromptGuard()`, `runPrecompact()`, telemetry recording, handoff saving/pruning
- `src/templates/hooks/save-tokens-statusline.sh` — Shell wrapper for statusline hook
- `src/templates/hooks/save-tokens-prompt-guard.sh` — Shell wrapper for prompt guard hook
- `src/templates/hooks/save-tokens-precompact.sh` — Shell wrapper for precompact hook
- `src/templates/commands/save-handoff.md` — Slash command to save a rich handoff summary
- `src/templates/commands/resume-handoff-latest.md` — Slash command to resume from most recent handoff
- `src/templates/commands/resume-handoff.md` — Slash command to list and pick a handoff to resume

## Key Concepts
- **Claude-only feature:** Save-tokens hooks and statusline only work with Claude Code. Config is stored in `.aspens.json` under `saveTokens`.
- **Three hook entry points:** Shell wrappers (`*.sh`) read stdin, resolve project dir, and call `save-tokens.mjs` with a subcommand (`statusline`, `prompt-guard`, `precompact`).
- **Statusline:** Records Claude context telemetry to `.aspens/sessions/claude-context.json` on every status update. Displays `save-tokens Xk/Yk` in the Claude status bar.
- **Prompt guard:** Checks token count against `warnAtTokens` (175k default) and `compactAtTokens` (200k default). Above compact threshold: saves a handoff and recommends starting a fresh session then running `/resume-handoff-latest`. Above warn threshold: suggests `/save-handoff`.
- **Precompact:** Auto-saves a handoff before Claude compaction when `saveHandoff` is enabled.
- **Handoff files:** Saved to `.aspens/sessions/<timestamp>-claude-handoff.md`. Structured with: metadata (tokens, working dir, branch), task summary, files modified, git commits, recent prompts, current state, next steps. Content extracted from JSONL transcript via `extractSessionFacts()`. Pruned to keep max 10.
- **`extractSessionFacts(input)`:** Parses the session's JSONL transcript to extract: `originalTask` (first user message), `recentPrompts` (last 3 user messages, 200 char max each), `filesModified` (from Edit/Write tool_use blocks), `gitCommits` (from Bash git commit commands), `branch` (from user record `gitBranch` field). Falls back to `input.prompt` as task summary when no transcript is available. Task summary capped at 500 chars.
- **Telemetry:** `recordClaudeContextTelemetry()` sums input/output/cache tokens from Claude's `context_window.current_usage`. Stale telemetry (>5 min) is ignored.
- **Config thresholds:** `warnAtTokens` and `compactAtTokens` can be `Number.MAX_SAFE_INTEGER` as disabled sentinel.
- **Settings merge:** `buildSaveTokensSettings()` produces `statusLine` + `hooks` config. Merged into existing `settings.json` via `mergeSettings()` which treats save-tokens hooks as aspens-managed.
- **`--recommended` install:** Called standalone or from `doc init --recommended`. Installs hooks, commands, sessions dir, settings — no prompts.
- **`--remove` uninstall:** Removes hook files (including legacy `.mjs` variants), commands, cleans settings.json entries, nulls `saveTokens` in `.aspens.json`.

## Critical Rules
- **Shell wrappers resolve project dir from script location** — `SCRIPT_DIR` → `PROJECT_DIR` via `cd "$SCRIPT_DIR/../.." && pwd`. `ASPENS_PROJECT_DIR` env var overrides `CLAUDE_PROJECT_DIR`.
- **Config validation in `target.js`** — `isValidSaveTokensConfig()` validates shape, types, and threshold ordering. Invalid config causes `readConfig()` to return `null`.
- **`writeConfig` preserves feature config** — `saveTokens` is preserved across `writeConfig` calls unless explicitly set to `null`.
- **Handoff pruning** — `pruneOldHandoffs()` keeps newest 10, deletes older. Only touches `*-handoff.md` files.
- **Sessions dir gitignored** — `.aspens/sessions/.gitignore` excludes everything except `.gitignore` and `README.md`.
- **Settings backup** — First install creates `.claude/settings.json.bak` if settings exist and no backup exists yet.
- **`doc init --recommended`** — Calls `installSaveTokensRecommended()` from `save-tokens.js`, also installs agents and doc-sync git hook.
- **Transcript parsing is best-effort** — `extractSessionFacts()` catches all errors and returns empty facts on failure. Invalid JSON lines are silently skipped.

## References
- **Impact integration:** `src/lib/impact.js` — `evaluateSaveTokensHealth()` validates installed state

---
**Last Updated:** 2026-04-10
