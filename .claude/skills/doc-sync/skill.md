---
name: doc-sync
description: Incremental skill updater that maps git diffs to affected skills and optionally auto-syncs via a post-commit hook
triggers:
  files:
    - src/commands/doc-sync.js
    - src/lib/diff-classifier.js
    - src/lib/diff-helpers.js
    - src/lib/git-hook.js
    - src/lib/git-helpers.js
    - src/prompts/doc-sync.md
    - src/prompts/doc-sync-refresh.md
    - src/prompts/partials/preservation-contract-refresh.md
  keywords:
    - doc sync
    - doc-sync
    - refresh
    - post-commit hook
    - install-hook
    - diff classifier
    - changetype filter
---

You are working on **doc-sync**, the incremental skill update command (`aspens doc sync`).

## Key Concepts
- **Monorepo-aware:** `getGitRoot(repoPath)` resolves the actual git root. `projectPrefix` (`toGitRelative`) computes the subdirectory offset. `scopeProjectFiles()` filters changed files to the project subdirectory. Diffs are fetched from `gitRoot` but file paths are project-relative.
- **Multi-target publish:** `configuredTargets()` reads `.aspens.json` for all configured targets. `chooseSyncSourceTarget()` picks the best source (prefers Claude if both exist). LLM generates for the source target; `publishFilesForTargets()` transforms output for all other configured targets. `graphSerialized` and `repoPath` are passed through to the transform context for conditional architecture references and disk-based instructions file loading.
- **Backend routing:** `runLLM()` from `runner.js` dispatches to `runClaude()` or `runCodex()` based on `config.backend` (defaults to source target's id).
- **Diff-based flow:** Gets `git diff HEAD~N..HEAD` from git root, scopes changed files to project prefix, then feeds diff plus existing skill contents and graph context to the selected backend.
- **Changetype filter (Phase 1):** `isNoOpDiff()` from `diff-classifier.js` skips the LLM call entirely on lockfile-only diffs and diffs touching zero code-bearing files. `LOCK_FILES` and `CODE_BEARING_EXTS` are the source of truth — extend them here, not at call sites.
- **Prompt path variables:** Passes `{ skillsDir, skillFilename, instructionsFile, configDir }` from source target to `loadPrompt()` for path substitution in prompts.
- **Refresh mode (`--refresh`):** Skips diff entirely. Reviews every skill against the current codebase. Base skill refreshed first, then domain skills in parallel batches of `PARALLEL_LIMIT` (3). Also refreshes instructions file and reports uncovered domains. Refresh mode runs `ensureRootKeyFilesSection` (legacy stripper) before `syncSkillsSection` so any leftover `## Key Files` blocks from old docs are removed.
- **Deterministic section repair:** `repairDeterministicSections()` runs a no-LLM pass that re-injects `## Skills` and `## Behavior` into the root instructions file from on-disk state and strips any legacy `## Key Files` block via `ensureRootKeyFilesSection`. Called from the no-op / "up to date" sync paths so missing-section drift is fixed every invocation. The normal sync flow also runs the same Skills + Behavior + legacy-strip block on the canonical instructions file after the LLM step.
- **Graph rebuild on every sync:** Calls `buildRepoGraph` + `persistGraphArtifacts` (with source target) to keep graph fresh. `graphSerialized` return value is captured and forwarded to `publishFilesForTargets` for conditional Codex architecture refs. Graph failure is non-fatal.
- **Legacy v0.7 hub-block cleanup:** `notifyLegacyHubBlockIfPresent()` surfaces a one-line notice on the first sync after upgrade when `CLAUDE.md`/`AGENTS.md` still carries the legacy `## Key Files` hub-counts block, so the diff that strips it isn't alarming. `regenerateStaleCodeMap()` force-rebuilds `.claude/code-map.md` on no-op syncs when it still carries the legacy `**Hub files**` block.
- **Graceful response handling:** After LLM returns, if output has content but no `<file>` tags, treats it as "no updates needed" with a verbose-only warning. The prompt explicitly requests an empty response when nothing needs updating.
- **Graph-aware skill mapping:** `mapChangesToSkills()` checks direct file matches via `fileMatchesActivation()` (from `skill-reader.js`) and also whether changed files are imported by files matching a skill's activation block.
- **Interactive file picker:** When diff exceeds 80k chars and TTY is available, offers multiselect with skill-relevant files pre-selected.
- **Prioritized diff:** `buildPrioritizedDiff()` gives skill-relevant files 60k char budget, everything else 20k (80k total). Cuts at `diff --git` boundaries.
- **Token optimization:** Affected skills sent in full; non-affected skills send only path + description line.
- **Split writes:** Direct-write files (`.claude/`, `CLAUDE.md`, root `AGENTS.md`) use `writeSkillFiles()`. Directory-scoped `AGENTS.md` files (e.g. `src/AGENTS.md`) use `writeTransformedFiles()`.
- **Skill-rules regeneration:** After writing, regenerates `skill-rules.json` via `extractRulesFromSkills()` — only for targets with `supportsHooks: true` (Claude). Uses `hookTarget` from publish targets list.
- **`findExistingSkills` is target-aware:** Uses `target.skillsDir` and `target.skillFilename` to locate skills for any target.
- **Git hook (monorepo-aware):** `installGitHook()` installs at the git root with per-project scoping. Hook uses `PROJECT_PATH` derived from project-relative offset. Each subproject gets its own labeled hook block (`# >>> aspens doc-sync hook (label) >>>`) with a unique function name (`__aspens_doc_sync_<slug>`). Multiple subprojects can coexist in one post-commit hook. Hook skips aspens-only commits scoped to the project prefix. 5-minute per-project cooldown via `/tmp/aspens-sync-<hash>.lock`; logs to `/tmp/aspens-sync-<hash>.log` (truncated to last 100 lines past 200). Unlabeled v0.6-era blocks are auto-upgraded on re-install.
- **Force writes:** doc-sync always calls `writeSkillFiles` with `force: true`.

## Critical Rules
- `runLLM` is called with `allowedTools: ['Read', 'Glob', 'Grep']` — doc-sync must never grant write tools.
- `parseOutput` restricts paths based on `getAllowedPaths([sourceTarget])` — paths outside the allowed set are silently dropped.
- **Unparseable output is a soft warning** — if LLM returns text without any `<file>` tags, doc-sync logs a verbose warning and treats it as "no updates needed" instead of throwing.
- `getGitDiff` gracefully falls back from N commits to 1 if fewer available. `actualCommits` tracks what was used.
- The command exits early with `CliError` if the source target's skills directory doesn't exist.
- `checkMissingHooks()` in `bin/cli.js` only checks for Claude skills (not Codex — Codex doesn't use hooks).
- `dedupeFiles()` ensures no duplicate paths when publishing across multiple targets.
- **Git operations use `gitRoot`** — diffs, logs, and changed files are fetched from git root, not `repoPath`. File paths are then scoped via `projectPrefix`.
- **`diff-classifier.js` is a leaf module** — `graph-builder.js` imports `LOCK_FILES` from it; never import from `graph-builder` back into the classifier.

## References
- **Patterns:** `src/lib/skill-reader.js` — `GENERIC_PATH_SEGMENTS`, `fileMatchesActivation()`, `getActivationBlock()`

---
**Last Updated:** 2026-05-11
