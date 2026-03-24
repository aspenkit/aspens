---
name: doc-sync
description: Incremental skill updater that maps git diffs to affected skills and optionally auto-syncs via a post-commit hook
---

## Activation

This skill triggers when editing doc-sync-related files:
- `src/commands/doc-sync.js`
- `src/prompts/doc-sync.md`

---

You are working on **doc-sync**, the incremental skill update command (`aspens doc sync`).

## Key Files
- `src/commands/doc-sync.js` — Main command: git diff → graph rebuild → skill mapping → Claude update → write
- `src/prompts/doc-sync.md` — System prompt sent to Claude (uses `{{skill-format}}` partial)
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()` shared across commands
- `src/lib/skill-writer.js` — `writeSkillFiles()` writes `{ path, content }[]` to disk
- `src/lib/graph-persistence.js` — `loadGraph()`, `extractSubgraph()`, `formatNavigationContext()` for graph context

## Key Concepts
- **Diff-based flow:** Gets `git diff HEAD~N..HEAD` and `git log`, feeds them plus existing skill contents and graph context to Claude.
- **Graph rebuild on every sync:** Calls `buildRepoGraph` + `persistGraphArtifacts` to keep `.claude/graph.json` fresh. Graph failure is non-fatal.
- **Graph-aware skill mapping:** `mapChangesToSkills()` checks not just direct file matches but also whether changed files are imported by files matching a skill's activation block.
- **Interactive file picker:** When diff exceeds 80k chars and TTY is available, offers multiselect with skill-relevant files pre-selected.
- **Prioritized diff:** Skill-relevant files get 60k char budget, everything else gets 20k (80k total). Cuts at `diff --git` boundaries.
- **Skill mapping:** Matches changed file names and meaningful path segments against `## Activation` sections. Generic segments excluded via `GENERIC_PATH_SEGMENTS`.
- **Token optimization:** Affected skills sent in full; non-affected skills send only path + description line.
- **Diff truncation:** `truncateDiff()` caps at configurable limit, cutting at the last `diff --git` boundary. CLAUDE.md capped at 5,000 chars.
- **Git hook:** `installGitHook()` creates a `post-commit` hook with 5-minute cooldown lock file. `removeGitHook()` removes via `>>>` / `<<<` markers.
- **Force writes:** doc-sync always calls `writeSkillFiles` with `force: true`.

## Critical Rules
- `runClaude` is called with `allowedTools: ['Read', 'Glob', 'Grep']` — doc-sync must never grant write tools.
- `parseFileOutput` restricts paths to `.claude/` prefix and `CLAUDE.md` exactly — any other path is silently dropped.
- `getGitDiff` gracefully falls back from N commits to 1 if fewer available. `actualCommits` tracks what was used.
- The command exits early with `CliError` if `.claude/skills/` doesn't exist.
- The hook cooldown uses `/tmp/aspens-sync-*.lock` keyed by repo path hash — don't change naming without updating cleanup.
- `checkMissingHooks()` in `bin/cli.js` warns when skills exist but hooks are missing (pre-0.2.2 installs).

---
**Last Updated:** 2026-03-24
