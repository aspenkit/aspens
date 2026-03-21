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
- `src/commands/doc-sync.js` — Main command: git diff → skill mapping → Claude update → write
- `src/prompts/doc-sync.md` — System prompt sent to Claude (uses `{{skill-format}}` partial)
- `src/lib/runner.js` — `runClaude()`, `loadPrompt()`, `parseFileOutput()` shared across commands
- `src/lib/skill-writer.js` — `writeSkillFiles()` writes `{ path, content }[]` to disk
- `src/lib/scanner.js` — `scanRepo()` used to detect domains for skill mapping

## Key Concepts
- **Diff-based flow:** Gets `git diff HEAD~N..HEAD` and `git log`, feeds them plus existing skill contents to Claude via `runClaude()` with read-only tools (`Read`, `Glob`, `Grep`).
- **Skill mapping:** `mapChangesToSkills()` matches changed file names and meaningful path segments against each skill's `## Activation` section. Generic segments (`src`, `lib`, `components`, etc.) are excluded via `GENERIC_PATH_SEGMENTS`. Base skill is flagged only when structural files change (`package.json`, `Dockerfile`, etc.).
- **Token optimization:** Affected skills are sent in full; non-affected skills send only path + description line.
- **Diff truncation:** `truncateDiff()` caps at 15,000 chars, cutting at the last `diff --git` boundary. CLAUDE.md is capped at 5,000 chars.
- **Output parsing:** Claude returns `<file path="...">` XML tags; `parseFileOutput()` in runner.js handles parsing and path sanitization (blocks `..`, absolute paths, only allows `.claude/` and `CLAUDE.md`).
- **Git hook:** `--install-hook` installs a `post-commit` hook with a 5-minute cooldown lock file (`/tmp/aspens-sync-*.lock`). Runs `npx aspens doc sync --commits 1` in background. Appends to existing hooks if present.
- **Force writes:** doc-sync always calls `writeSkillFiles` with `force: true` — it overwrites existing skills without prompting.

## Critical Rules
- `runClaude` is called with `allowedTools: ['Read', 'Glob', 'Grep']` — doc-sync must never grant write tools to the inner Claude call.
- `parseFileOutput` restricts output paths to `.claude/` prefix and `CLAUDE.md` exactly — any other path is silently dropped. Do not change these guards.
- The `getGitDiff` function gracefully falls back from N commits to 1 if the repo has fewer commits than requested. `actualCommits` tracks what was actually used.
- The command exits early with an error if `.claude/skills/` doesn't exist — it requires `aspens doc init` to have been run first.
- The hook cooldown mechanism uses `/tmp` lock files keyed by repo path hash — don't change the naming scheme without updating cleanup logic.

---
**Last Updated:** 2026-03-21
