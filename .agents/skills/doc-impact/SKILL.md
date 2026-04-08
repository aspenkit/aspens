---
name: doc-impact
description: Context health analysis — freshness, domain coverage, hub surfacing, drift detection for generated agent context
---

## Activation

This skill triggers when editing doc-impact files:
- `src/commands/doc-impact.js`
- `src/lib/impact.js`
- `tests/impact.test.js`

Keywords: impact, freshness, coverage, drift, health score, context health

---

You are working on **doc impact** — the command that shows whether generated agent context is keeping up with the codebase.

## Key Files
- `src/commands/doc-impact.js` — CLI command: calls `analyzeImpact()`, renders per-target report with health scores, coverage, drift, and recommended actions
- `src/lib/impact.js` — Core analysis: `analyzeImpact()` orchestrates scan + config + graph + per-target summarization
- `tests/impact.test.js` — Unit tests for coverage, drift, health score, status, and report summarization

## Key Concepts
- **`analyzeImpact(repoPath, options)`** — Main entry point. Runs `scanRepo()`, loads config from `.aspens.json`, infers targets if not configured, collects source file state, optionally builds import graph, then produces per-target reports.
- **Target inference:** If no `.aspens.json` config, infers targets from scan results (`.claude/` → claude, `.agents/` → codex). Falls back to `['claude']`.
- **`summarizeTarget()`** — Per-target analysis: finds skills, checks instruction file existence, computes domain coverage, hub coverage, drift, status, health score, and recommended actions.
- **Domain coverage:** `computeDomainCoverage()` matches scan-detected domains against installed skills by name match or activation pattern match. Returns covered/missing counts with reasons.
- **Hub coverage:** `computeHubCoverage()` checks if top 5 graph hub file paths appear in the instruction file + base skill text.
- **Drift detection:** `computeDrift()` finds source files modified after the latest generated context mtime. Maps changed files to affected domains via directory matching.
- **Health score:** `computeHealthScore()` starts at 100, deducts for: missing instructions (-35), no skills (-25), domain gaps (up to -25), missed hubs (-4 each), drift (-3 per file, max -20), missing hooks (-10 for Claude).
- **Source state collection:** `collectSourceState()` walks repo (depth 5, skips dotfiles/node_modules/dist/build/coverage), collects mtime for source extensions only (`SOURCE_EXTS` set).
- **Recommended actions:** `recommendActions()` suggests `aspens doc init --recommended` for missing context, `aspens doc sync` for stale context, `aspens doc init --hooks-only` for missing hooks.

## Critical Rules
- **No LLM calls** — impact analysis is fully deterministic (scan + filesystem + optional graph).
- **`--no-graph` flag** — skips import graph build; hub coverage section shows `n/a`.
- **Graph failure is non-fatal** — if `buildRepoGraph` throws, graph is set to null and analysis continues without hub data.
- **`SOURCE_EXTS` set** — only these extensions count as source files for drift detection. Adding a language requires updating this set.
- **Walk depth capped at 5** — deep nested source files won't appear in drift analysis.
- **Exported functions** — `computeDomainCoverage`, `computeHubCoverage`, `computeDrift`, `computeHealthScore`, `computeTargetStatus`, `recommendActions`, `summarizeReport` are all individually exported for testing.

## References
- **Patterns:** `src/lib/skill-reader.js` — `findSkillFiles()` used for skill discovery per target

---
**Last Updated:** 2026-04-08
