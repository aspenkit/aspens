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
- `src/lib/target.js` — Target definitions (`TARGETS`), `getAllowedPaths()`, path helpers, config persistence (`.aspens.json`)
- `src/lib/target-transform.js` — Transforms Claude-format output to other target formats; `projectCodexDomainDocs()`, `validateTransformedFiles()`, content sanitization
- `src/lib/backend.js` — Backend detection (`detectAvailableBackends`) and resolution (`resolveBackend`) with fallback logic

## Key Concepts
- **Target vs Backend:** Target = where output goes (claude → `.claude/skills/`, codex → `.agents/skills/` + directory-scoped `AGENTS.md`). Backend = which LLM CLI generates the content (`claude -p` or `codex exec`).
- **Target definitions:** `TARGETS.claude` (centralized) and `TARGETS.codex` (directory-scoped). Each defines paths and capability flags: `supportsHooks`, `supportsSettings`, `supportsGraph`, `supportsSkills`, `needsActivationSection`, `needsCodeMapEmbed`, `supportsMCP`. Codex also has `maxInstructionsBytes` (32 KiB) and `userSkillsDir`.
- **Canonical generation:** Generation always produces Claude-canonical format first. Prompts always receive `CANONICAL_VARS` (hardcoded Claude paths from `doc-init.js`). Transforms run **after** generation to produce other target formats.
- **Content transform:** `transformForTarget()` remaps paths and content. For Codex: base skill → root `AGENTS.md`, domain skills → both `.agents/skills/{domain}/SKILL.md` and source directory `AGENTS.md`. `generateCodexSkillReferences()` creates `.agents/skills/architecture/` with code-map data.
- **Content sanitization:** `sanitizeCodexInstructions()` and `sanitizeCodexSkill()` strip Claude-specific references (hooks, skill-rules.json, Claude Code mentions) from Codex output.
- **`getAllowedPaths(targets)`** — Returns `{ dirPrefixes, exactFiles }` union across all active targets. Used by `parseFileOutput()` to validate LLM output paths.
- **Backend detection:** `detectAvailableBackends()` checks if `claude` and `codex` CLIs are installed. `resolveBackend()` picks best match: explicit flag > target match > fallback.
- **Config persistence:** `.aspens.json` at repo root stores `{ targets, backend, version }`. `readConfig()` returns null if missing — callers default to `'claude'` target.
- **Multi-target publish:** `doc-sync` uses `publishFilesForTargets()` to generate output for all configured targets from a single LLM run — source target files kept as-is, other targets get transforms applied.

## Critical Rules
- **Generation always targets Claude canonical format first** — transforms run after, never during. Prompts always receive `CANONICAL_VARS`.
- **Split write logic:** `writeSkillFiles()` handles direct-write files (`.claude/`, `.agents/`, `AGENTS.md`, root `AGENTS.md`). `writeTransformedFiles()` handles directory-scoped `AGENTS.md` (e.g., `src/billing/AGENTS.md`) with warn-and-skip policy.
- **Path safety:** `validateTransformedFiles()` in `target-transform.js` rejects absolute paths, traversal, and unexpected filenames. `writeTransformedFiles()` enforces the same checks.
- **Codex-only restrictions:** `add agent/command/hook` and `customize agents` throw `CliError` for Codex-only repos. `add skill` works for both targets.
- **Graph/hooks are Claude-only** — `persistGraphArtifacts()` returns data without writing files when `target.supportsGraph === false`. Hook installation skipped when `supportsHooks === false`.

## References
- **Patterns:** See `src/lib/target.js` for all target property definitions

---
**Last Updated:** 2026-04-02
