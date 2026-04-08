---
name: codex-support
description: Multi-target output system — target abstraction, backend routing, content transforms for Codex CLI and future targets
---

## Activation

This skill triggers when editing codex-support files:
- `src/lib/target.js`
- `src/lib/target-transform.js`
- `src/lib/backend.js`
- `tests/target.test.js`
- `tests/target-transform.test.js`
- `tests/backend.test.js`

Keywords: codex, target, backend, AGENTS.md, directory-scoped, transform, multi-target

---

You are working on **multi-target output support** — the system that lets aspens generate documentation for Claude Code, Codex CLI, or both simultaneously.

## Key Files
- `src/lib/target.js` — Target definitions (`TARGETS`), `getAllowedPaths()`, `mergeConfiguredTargets()`, path helpers, config persistence (`.aspens.json`)
- `src/lib/target-transform.js` — Transforms Claude-format output to other target formats; `projectCodexDomainDocs()`, `validateTransformedFiles()`, `ensureRootKeyFilesSection()`, content sanitization
- `src/lib/backend.js` — Backend detection (`detectAvailableBackends`) and resolution (`resolveBackend`) with fallback logic

## Key Concepts
- **Target vs Backend:** Target = where output goes (claude → `.claude/skills/`, codex → `.agents/skills/` + directory-scoped `AGENTS.md`). Backend = which LLM CLI generates the content (`claude -p` or `codex exec`).
- **Target definitions:** `TARGETS.claude` (centralized) and `TARGETS.codex` (directory-scoped). Each defines paths and capability flags: `supportsHooks`, `supportsSettings`, `supportsGraph`, `supportsSkills`, `needsActivationSection`, `needsCodeMapEmbed`, `supportsMCP`. Codex also has `maxInstructionsBytes` (32 KiB) and `userSkillsDir`.
- **Canonical generation:** Generation always produces Claude-canonical format first. Prompts always receive `CANONICAL_VARS` (hardcoded Claude paths from `doc-init.js`). Transforms run **after** generation to produce other target formats.
- **Content transform:** `transformForTarget()` remaps paths and content. For Codex: base skill → root `AGENTS.md`, domain skills → both `.agents/skills/{domain}/SKILL.md` and source directory `AGENTS.md`. `generateCodexSkillReferences()` creates `.agents/skills/architecture/` with code-map data.
- **Content sanitization:** `sanitizeCodexInstructions()` and `sanitizeCodexSkill()` strip Claude-specific references (hooks, skill-rules.json, Claude Code mentions) from Codex output.
- **`ensureRootKeyFilesSection(content, graphSerialized)`** — Post-processes root instructions file (CLAUDE.md) to guarantee a `## Key Files` section with top hub files from the graph. Replaces an existing incomplete section or inserts before `## Behavior` / `**Last Updated**`. Used by `doc-init` chunked mode after CLAUDE.md generation.
- **`mergeConfiguredTargets(existing, next)`** — Merges target arrays to avoid dropping previously configured targets during narrower runs. Validates against `TARGETS` keys, deduplicates.
- **`getAllowedPaths(targets)`** — Returns `{ dirPrefixes, exactFiles }` union across all active targets. Dir prefixes use **full** target paths (e.g., `.agents/skills/`, not `.agents/`), providing tighter path validation.
- **Backend detection:** `detectAvailableBackends()` checks if `claude` and `codex` CLIs are installed. `resolveBackend()` picks best match: explicit flag > target match > fallback.
- **Config persistence:** `.aspens.json` at repo root stores `{ targets, backend, version }`. `readConfig()` returns `null` if missing **or if the config is structurally invalid** — callers default to `'claude'` target. Validation via internal `isValidConfig()` ensures `targets` is a non-empty array of known target keys, `backend` (if present) is a known target key, and `version` (if present) is a string.
- **Multi-target publish:** `doc-sync` uses `publishFilesForTargets()` to generate output for all configured targets from a single LLM run — source target files kept as-is, other targets get transforms applied.
- **Codex inference tightened:** `inferConfig()` only adds `'codex'` to inferred targets when `.codex/` config dir or `.agents/skills/` dir exists — a standalone `AGENTS.md` without either is not sufficient.
- **Conditional architecture ref:** Codex `buildCodexSkillRefs()` only includes the architecture skill reference when a graph was actually serialized (`hasGraph` parameter).

## Critical Rules
- **Generation always targets Claude canonical format first** — transforms run after, never during. Prompts always receive `CANONICAL_VARS`.
- **Split write logic:** `writeSkillFiles()` handles direct-write files (`.claude/`, `.agents/`, `CLAUDE.md`, root `AGENTS.md`). `writeTransformedFiles()` handles directory-scoped `AGENTS.md` (e.g., `src/billing/AGENTS.md`) with an explicit path allowlist and warn-and-skip policy.
- **Path safety:** `validateTransformedFiles()` in `target-transform.js` rejects absolute paths, traversal, and unexpected filenames. `writeTransformedFiles()` enforces the same checks plus an allowlist (`CLAUDE.md`/`AGENTS.md` exact, `.claude/`/`.agents/`/`.codex/` prefixes).
- **Codex-only restrictions:** `add agent/command/hook` and `customize agents` throw `CliError` for Codex-only repos. `add skill` works for both targets.
- **Graph/hooks are Claude-only** — `persistGraphArtifacts()` returns data without writing files when `target.supportsGraph === false`. Hook installation skipped when `supportsHooks === false`.
- **Config validation is defensive** — `readConfig()` treats malformed but parseable JSON (e.g., wrong types for `targets`/`backend`/`version`) as invalid and returns `null`, same as missing config.

## References
- **Patterns:** See `src/lib/target.js` for all target property definitions

---
**Last Updated:** 2026-04-08
