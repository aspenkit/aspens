---
name: doc-impact
description: Context health analysis — freshness, domain coverage, hub surfacing, drift detection, LLM-powered interpretation, and auto-repair for generated agent context
---

## Activation

This skill triggers when editing doc-impact files:
- `src/commands/doc-impact.js`
- `src/lib/impact.js`
- `src/prompts/impact-analyze.md`
- `tests/impact.test.js`
- `tests/doc-impact.test.js`

Keywords: impact, freshness, coverage, drift, health score, context health, hook health, usefulness

---

You are working on **doc impact** — the command that shows whether generated agent context is keeping up with the codebase, optionally interprets results via LLM, and can interactively apply recommended repairs.

## Key Files
- `src/commands/doc-impact.js` — CLI command: calls `analyzeImpact()`, renders per-target report with health scores, coverage, drift, usefulness, hook health, save-tokens health, LLM interpretation, opportunities, and interactive apply confirmation
- `src/lib/impact.js` — Core analysis: `analyzeImpact()` orchestrates scan + config + graph + per-target summarization; exports `evaluateHookHealth()`, `evaluateSaveTokensHealth()`, `summarizeOpportunities()`, `summarizeValueComparison()`, `summarizeMissing()`
- `src/prompts/impact-analyze.md` — System prompt for LLM-powered impact interpretation (returns JSON with `bottom_line`, `improves`, `risks`, `next_step`)
- `tests/impact.test.js` — Unit tests for coverage, drift, health score, status, report summarization, value comparison, missing rollup, hook health, save-tokens health, opportunities
- `tests/doc-impact.test.js` — Unit tests for `buildApplyPlan()` and `buildApplyConfirmationMessage()`

## Key Concepts
- **`analyzeImpact(repoPath, options)`** — Main entry point. Runs `scanRepo()`, loads config from `.aspens.json`, infers targets if not configured, collects source file state, optionally builds import graph, then produces per-target reports. Now also computes `summary.opportunities`.
- **Target inference:** If no `.aspens.json` config, infers targets from scan results (`.claude/` → claude, `.agents/` → codex). Falls back to `['claude']`.
- **`summarizeTarget()`** — Per-target analysis: finds skills, evaluates hook health, evaluates save-tokens health (Claude only), checks instruction file existence, computes domain coverage, hub coverage, drift, usefulness, status, health score, and recommended actions.
- **Domain coverage:** `computeDomainCoverage()` matches scan-detected domains against installed skills. Filters out `LOW_SIGNAL_DOMAIN_NAMES` (config, test, tests, __tests__, spec, e2e) from scoring — tracked in `excluded` field.
- **Hub coverage:** `computeHubCoverage()` checks if top 5 graph hub file paths appear in the instruction file + base skill text.
- **Drift detection:** `computeDrift()` finds source files modified after the latest generated context mtime. Maps changed files to affected domains via directory matching.
- **Health score:** `computeHealthScore()` starts at 100, deducts for: missing instructions (-35), no skills (-25), domain gaps (up to -25), missed hubs (-4 each), drift (-3 per file, max -20), unhealthy hooks (-10 for Claude), broken save-tokens (-5 for Claude).
- **Hook health:** `evaluateHookHealth(repoPath)` checks for required hook scripts, validates `settings.json` hook commands resolve to existing files.
- **Save-tokens health:** `evaluateSaveTokensHealth(repoPath, saveTokensConfig)` checks if configured save-tokens installation is complete — validates required hook files, command files, legacy file cleanup, and settings.json entries. Returns `{ configured, healthy, issues, missingHookFiles, missingCommandFiles, invalidCommands, installedLegacyHookFiles }`.
- **Opportunities:** `summarizeOpportunities(repoPath, targets, config)` identifies optional aspens features not yet installed: save-tokens, agents, agent customization, doc-sync hook. Each returns `{ kind, message, command }`. Displayed in the "Missing Aspens Setup" section.
- **Usefulness summary:** `summarizeUsefulness()` produces `{ strengths, blindSpots, activationExamples }` per target.
- **Value comparison:** `summarizeValueComparison(targets)` computes before/after metrics for the report header.
- **Missing rollup:** `summarizeMissing(targets)` aggregates cross-target gaps including broken save-tokens installations with severity levels.
- **LLM interpretation:** If CLI backend is available, sends report + comparison as JSON to `impact-analyze` prompt. `saveTokensHealth` included in the analysis payload.
- **Interactive apply:** `buildApplyPlan(targets)` collects all recommended actions across targets with interactive confirmation.

## Critical Rules
- **LLM interpretation is optional** — runs only if a CLI backend is detected. Failure is caught and reported as "Analysis unavailable".
- **LLM gets no tools** — `disableTools: true` passed to `runLLM()`. The prompt expects pure JSON output.
- **`--no-graph` flag** — skips import graph build; hub coverage section shows `n/a`.
- **Graph failure is non-fatal** — if `buildRepoGraph` throws, graph is set to null and analysis continues without hub data.
- **`SOURCE_EXTS` set** — only these extensions count as source files for drift detection. Adding a language requires updating this set.
- **Walk depth capped at 5** — deep nested source files won't appear in drift analysis.
- **`LOW_SIGNAL_DOMAIN_NAMES`** — `config`, `test`, `tests`, `__tests__`, `spec`, `e2e` are excluded from domain coverage scoring but tracked in `excluded` array.
- **Exported functions** — `computeDomainCoverage`, `computeHubCoverage`, `computeDrift`, `evaluateHookHealth`, `evaluateSaveTokensHealth`, `computeHealthScore`, `computeTargetStatus`, `recommendActions`, `summarizeReport`, `summarizeMissing`, `summarizeOpportunities`, `summarizeValueComparison` from `impact.js`; `buildApplyPlan`, `buildApplyConfirmationMessage` from `doc-impact.js`.

## References
- **Patterns:** `src/lib/skill-reader.js` — `findSkillFiles()` used for skill discovery per target
- **Prompt:** `src/prompts/impact-analyze.md`

---
**Last Updated:** 2026-04-09
