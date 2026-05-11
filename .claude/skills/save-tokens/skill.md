---
name: save-tokens
description: Token-saving session automation — statusline, prompt guard, precompact handoffs, session rotation, and handoff commands for Claude Code
triggers:
  files:
    - src/commands/save-tokens.js
    - src/lib/save-tokens.js
    - src/templates/hooks/save-tokens*.sh
    - src/templates/hooks/save-tokens.mjs
    - src/templates/commands/save-handoff.md
    - src/templates/commands/resume-handoff*.md
    - tests/save-tokens*.test.js
  keywords:
    - save-tokens
    - handoff
    - statusline
    - prompt-guard
    - precompact
    - session rotation
    - token warning
---

You are working on **save-tokens** — the feature that installs Claude Code hooks and commands to warn about token usage, auto-save handoffs before compaction, and support session rotation.

## Domain purpose
`aspens save-tokens` installs three Claude Code hooks (statusline, prompt-guard, precompact) plus `/save-handoff`, `/resume-handoff-latest`, and `/resume-handoff` slash commands. The hooks observe Claude's own token telemetry and inject system messages telling Claude to rotate sessions before context blow-up. Handoff files persist enough state in `.aspens/sessions/` to resume seamlessly in a fresh session.

## Business rules / invariants
- **Claude-only feature.** Hooks and statusline only work with Claude Code; Codex has no save-tokens integration. Config lives in `.aspens.json` under `saveTokens`.
- **Config thresholds default 175k warn / 200k compact.** `Number.MAX_SAFE_INTEGER` is the disabled sentinel for either threshold; `target.js#isValidSaveTokensConfig()` validates shape, types, and threshold ordering — invalid config causes `readConfig()` to return `null`.
- **`writeConfig` preserves feature config** — `saveTokens` is preserved across `writeConfig` calls unless explicitly set to `null`.
- **Sessions dir gitignored** — `.aspens/sessions/.gitignore` excludes everything except `.gitignore` and `README.md`.
- **Settings backup** — first install creates `.claude/settings.json.bak` if settings exist and no backup exists yet.
- **StatusLine pre-existence guard** — `canInstallSaveTokensStatusLine()` refuses to overwrite an unrelated custom `statusLine.command`; when refused, `applyStatusLineAvailability()` forces both thresholds to `MAX_SAFE_INTEGER` and disables `sessionRotation`.

## Non-obvious behaviors
- **Three hook entry points dispatched by subcommand.** Shell wrappers (`*.sh`) read stdin, resolve project dir, and call `save-tokens.mjs` with `statusline`, `prompt-guard`, or `precompact`. `ASPENS_PROJECT_DIR` env var overrides `CLAUDE_PROJECT_DIR`; both fall back to `cwd`.
- **Statusline doubles as telemetry recorder.** `recordClaudeContextTelemetry()` writes `.aspens/sessions/claude-context.json` summing `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens` from `context_window.current_usage`. Telemetry older than 5 minutes is ignored by the prompt guard.
- **Prompt-guard speaks to Claude, not the user.** Above `compactAtTokens`: saves a handoff (reason `rotation-threshold` if `sessionRotation`, else `compact-threshold`) and stdout-prints an "IMPORTANT — you must tell the user" block instructing fresh session + `/resume-handoff-latest`. Above `warnAtTokens`: suggests `/save-handoff`. When telemetry is missing, prints a one-time link to the aspens issues page.
- **Precompact hook only fires when `saveHandoff` is enabled** and `claude.enabled !== false`; reason is `precompact`.
- **`extractSessionFacts()` parses the JSONL transcript** to extract `originalTask` (first user message, 500 char cap), `recentPrompts` (last 3, 200 char cap each), `filesModified` (Edit/Write tool_use `file_path`), `gitCommits` (regex on Bash `git commit -m "..."`), and `branch` (from `gitBranch` on user records). Transcript path is validated to be inside `projectDir`; falls back to `input.prompt` when transcript is missing or outside the project.
- **Transcript parsing is best-effort** — all errors caught, invalid JSON lines silently skipped; returns empty facts on failure.
- **`pruneOldHandoffs()` keeps newest 10** `*-handoff.md` files by lexicographic (timestamp) sort; older are unlinked. `latestHandoff()` uses the same sort.
- **`--recommended` install is non-interactive** — used standalone or invoked by `doc init --recommended` (which also installs agents and the doc-sync git hook).
- **`--remove` cleans legacy artifacts too** — removes both `.sh` and historic `.mjs` variants of each hook, plus the legacy `save-tokens-resume.md` command; strips `statusLine` if it points at save-tokens and filters any hook entry whose command contains `save-tokens-`; nulls `saveTokens` in `.aspens.json`.

## Critical files (purpose, not inventory)
- `src/commands/save-tokens.js` — install/remove orchestration; interactive multiselect (`warnings`, `handoffs`), `--recommended`, `--remove`. Exports `installSaveTokensRecommended()` consumed by `doc-init.js`.
- `src/lib/save-tokens.js` — config + settings + template content builders (`DEFAULT_SAVE_TOKENS_CONFIG`, `buildSaveTokensConfig`, `buildSaveTokensSettings`, `buildSaveTokensGitignore`, `buildSaveTokensReadme`, `buildSaveTokensRecommendations`).
- `src/templates/hooks/save-tokens.mjs` — runtime library: `runStatusline`, `runPromptGuard`, `runPrecompact`, `saveHandoff`, `extractSessionFacts`, telemetry record/read, handoff pruning, `main()` subcommand dispatch.
- `src/templates/hooks/save-tokens-{statusline,prompt-guard,precompact}.sh` — shell wrappers; resolve `PROJECT_DIR` via `cd "$SCRIPT_DIR/../.." && pwd` and exec the `.mjs` with the matching subcommand.
- `src/templates/commands/{save-handoff,resume-handoff-latest,resume-handoff}.md` — slash command bodies installed under `.claude/commands/`.

## Critical Rules
- **Settings merge uses `mergeSettings()`** from `skill-writer.js` — save-tokens hooks are treated as aspens-managed; do not hand-edit `.claude/settings.json` to add/remove save-tokens entries.
- **Hooks write to stdout to inject into Claude's context** — comments in `runPromptGuard()` flag this; keep those messages addressed to Claude ("Tell the user...") not to a human reader.
- **Token sum includes cache tokens** — do not switch to just `input_tokens + output_tokens`; that under-counts Claude's effective context use.

## References
- **Impact integration:** `src/lib/impact.js` — `evaluateSaveTokensHealth()` validates installed state

---
**Last Updated:** 2026-05-11
