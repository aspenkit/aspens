---
name: doc-sync
description: Incremental skill updater that maps git diffs to affected skills and optionally auto-syncs via a post-commit hook
---

## Activation

This skill triggers when editing doc-sync-related files:
- `src/commands/doc-sync.js`
- `src/prompts/doc-sync.md`
- `src/prompts/doc-sync-refresh.md`
- `src/lib/git-helpers.js`
- `src/lib/diff-helpers.js`
- `src/lib/git-hook.js`

Keywords: doc-sync, refresh, sync, git-hook

---

You are working on **doc-sync**, the incremental skill update command (`aspens doc sync`).

## Key Files
- `src/commands/doc-sync.js` — Main command: git diff → graph rebuild → skill mapping → LLM update → publish for targets → write. Also contains refresh mode and `skillToDomain()` export.
- `src/prompts/doc-sync.md` — System prompt for diff-based sync (uses `{{skill-format}}` partial, target-specific path variables)
- `src/prompts/doc-sync-refresh.md` — System prompt for `--refresh` mode (full skill review)
- `src/lib/git-helpers.js` — `isGitRepo()`, `getGitDiff()`, `getGitLog()`, `getChangedFiles()` — git primitives
- `src/lib/diff-helpers.js` — `getSelectedFilesDiff()`, `buildPrioritizedDiff()`, `truncateDiff()`, `truncate()` — diff budgeting
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync
- `src/lib/context-builder.js` — `buildDomainContext()`, `buildBaseContext()` used by refresh mode
- `src/lib/runner.js` — `runClaude()`, `runCodex()`, `loadPrompt()`, `parseFileOutput()` shared across commands
- `src/lib/skill-writer.js` — `writeSkillFiles()`, `writeTransformedFiles()`, `extractRulesFromSkills()` for output
- `src/lib/target-transform.js` — `projectCodexDomainDocs()`, `transformForTarget()` for multi-target publish

## Key Concepts
- **Multi-target publish:** `configuredTargets()` reads `.aspens.json` for all configured targets. `chooseSyncSourceTarget()` picks the best source (prefers Claude if both exist). LLM generates for the source target; `publishFilesForTargets()` transforms output for all other configured targets.
- **Backend routing:** Local `runLLM()` dispatches to `runClaude()` or `runCodex()` based on `config.backend` (defaults to source target's id).
- **Diff-based flow:** Gets `git diff HEAD~N..HEAD` and `git log`, feeds them plus existing skill contents and graph context to the selected backend.
- **Prompt path variables:** Passes `{ skillsDir, skillFilename, instructionsFile, configDir }` from source target to `loadPrompt()` for path substitution in prompts.
- **Refresh mode (`--refresh`):** Skips diff entirely. Reviews every skill against the current codebase. Base skill refreshed first, then domain skills in parallel batches of `PARALLEL_LIMIT` (3). Also refreshes instructions file and reports uncovered domains.
- **Graph rebuild on every sync:** Calls `buildRepoGraph` + `persistGraphArtifacts` (with source target) to keep graph fresh. Graph failure is non-fatal.
- **Graph-aware skill mapping:** `mapChangesToSkills()` checks direct file matches via `fileMatchesActivation()` (from `skill-reader.js`) and also whether changed files are imported by files matching a skill's activation block.
- **Interactive file picker:** When diff exceeds 80k chars and TTY is available, offers multiselect with skill-relevant files pre-selected.
- **Prioritized diff:** `buildPrioritizedDiff()` gives skill-relevant files 60k char budget, everything else 20k (80k total). Cuts at `diff --git` boundaries.
- **Token optimization:** Affected skills sent in full; non-affected skills send only path + description line.
- **Split writes:** Direct-write files (`.claude/`, `CLAUDE.md`, root `AGENTS.md`) use `writeSkillFiles()`. Directory-scoped `AGENTS.md` files (e.g. `src/AGENTS.md`) use `writeTransformedFiles()`.
- **Skill-rules regeneration:** After writing, regenerates `skill-rules.json` via `extractRulesFromSkills()` — only for targets with `supportsHooks: true` (Claude). Uses `hookTarget` from publish targets list.
- **`findExistingSkills` is target-aware:** Uses `target.skillsDir` and `target.skillFilename` to locate skills for any target.
- **Git hook:** `installGitHook()` creates a `post-commit` hook with 5-minute cooldown lock file. Hook skips aspens-only commits (filters `.claude/`, `.codex/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.aspens.json`). Works for all configured targets.
- **Force writes:** doc-sync always calls `writeSkillFiles` with `force: true`.

## Critical Rules
- `runLLM` is called with `allowedTools: ['Read', 'Glob', 'Grep']` — doc-sync must never grant write tools.
- `parseOutput` restricts paths based on `getAllowedPaths([sourceTarget])` — paths outside the allowed set are silently dropped.
- `getGitDiff` gracefully falls back from N commits to 1 if fewer available. `actualCommits` tracks what was used.
- The command exits early with `CliError` if the source target's skills directory doesn't exist.
- `checkMissingHooks()` in `bin/cli.js` only checks for Claude skills (not Codex — Codex doesn't use hooks).
- `dedupeFiles()` ensures no duplicate paths when publishing across multiple targets.

## References
- **Patterns:** `src/lib/skill-reader.js` — `GENERIC_PATH_SEGMENTS`, `fileMatchesActivation()`, `getActivationBlock()`

---
**Last Updated:** 2026-04-02
