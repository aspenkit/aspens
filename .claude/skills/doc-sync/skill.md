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
- `src/commands/doc-sync.js` — Main command: git diff → graph rebuild → skill mapping → Claude update → write. Also contains refresh mode and `skillToDomain()` export.
- `src/prompts/doc-sync.md` — System prompt for diff-based sync (uses `{{skill-format}}` partial, target-specific path variables)
- `src/prompts/doc-sync-refresh.md` — System prompt for `--refresh` mode (full skill review)
- `src/lib/git-helpers.js` — `isGitRepo()`, `getGitDiff()`, `getGitLog()`, `getChangedFiles()` — git primitives
- `src/lib/diff-helpers.js` — `getSelectedFilesDiff()`, `buildPrioritizedDiff()`, `truncateDiff()` — diff budgeting
- `src/lib/git-hook.js` — `installGitHook()` / `removeGitHook()` for post-commit auto-sync
- `src/lib/context-builder.js` — `buildDomainContext()`, `buildBaseContext()` used by refresh mode
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()` shared across commands
- `src/lib/skill-writer.js` — `writeSkillFiles()`, `extractRulesFromSkills()` for output

## Key Concepts
- **Target-aware:** Reads `.aspens.json` via `readConfig()` to determine active target. Defaults to `claude` if no config. Uses target's `skillsDir`, `skillFilename`, and `instructionsFile` for all path operations.
- **Diff-based flow:** Gets `git diff HEAD~N..HEAD` and `git log`, feeds them plus existing skill contents and graph context to Claude.
- **Prompt path variables:** Passes `{ skillsDir, skillFilename, instructionsFile, configDir }` to `loadPrompt()` for target-specific path substitution in prompts.
- **Refresh mode (`--refresh`):** Skips diff entirely. Reviews every skill against the current codebase. Base skill refreshed first, then domain skills in parallel batches of `PARALLEL_LIMIT` (3). Also refreshes instructions file (CLAUDE.md or AGENTS.md) and reports uncovered domains.
- **Graph rebuild on every sync:** Calls `buildRepoGraph` + `persistGraphArtifacts` (with target) to keep graph fresh. Graph failure is non-fatal.
- **Graph-aware skill mapping:** `mapChangesToSkills()` checks direct file matches via `fileMatchesActivation()` (from `skill-reader.js`) and also whether changed files are imported by files matching a skill's activation block.
- **Interactive file picker:** When diff exceeds 80k chars and TTY is available, offers multiselect with skill-relevant files pre-selected.
- **Prioritized diff:** `buildPrioritizedDiff()` gives skill-relevant files 60k char budget, everything else 20k (80k total). Cuts at `diff --git` boundaries.
- **Token optimization:** Affected skills sent in full; non-affected skills send only path + description line.
- **Skill-rules regeneration:** After writing, regenerates `skill-rules.json` via `extractRulesFromSkills()` — only for targets with `supportsHooks: true` (Claude).
- **`findExistingSkills` is target-aware:** Uses `target.skillsDir` and `target.skillFilename` to locate skills for any target.
- **Git hook:** `installGitHook()` creates a `post-commit` hook with 5-minute cooldown lock file. Hook skips aspens-only commits (filters `.claude/`, `.codex/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.aspens.json`).
- **Force writes:** doc-sync always calls `writeSkillFiles` with `force: true`.

## Critical Rules
- `runClaude` is called with `allowedTools: ['Read', 'Glob', 'Grep']` — doc-sync must never grant write tools.
- `parseFileOutput` restricts paths to `.claude/` prefix and `CLAUDE.md` exactly — any other path is silently dropped.
- `getGitDiff` gracefully falls back from N commits to 1 if fewer available. `actualCommits` tracks what was used.
- The command exits early with `CliError` if the target's skills directory doesn't exist.
- `checkMissingHooks()` in `bin/cli.js` only checks for Claude skills (not Codex — Codex doesn't use hooks).

## References
- **Patterns:** `src/lib/skill-reader.js` — `GENERIC_PATH_SEGMENTS`, `fileMatchesActivation()`, `getActivationBlock()`

---
**Last Updated:** 2026-04-02
