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
- `src/lib/target.js` — Target definitions (`TARGETS`), path helpers, config persistence (`.aspens.json`)
- `src/lib/target-transform.js` — Transforms Claude-format output to other target formats (directory-scoped AGENTS.md for Codex)
- `src/lib/backend.js` — Backend detection and resolution (which CLI generates content)

## Key Concepts
- **Target vs Backend:** Target = where output goes (claude → `.claude/skills/`, codex → directory-scoped `AGENTS.md`). Backend = which LLM CLI generates the content (`claude -p` or `codex exec`).
- **Target definitions:** `TARGETS.claude` (centralized: `.claude/skills/{domain}/skill.md`) and `TARGETS.codex` (directory-scoped: `src/billing/AGENTS.md`). Each defines paths, capabilities (`supportsHooks`, `supportsGraph`, `supportsSettings`).
- **Content transform:** Generation always produces Claude-target paths. `transformForTarget()` remaps paths and content for other targets. For Codex: base skill → root `AGENTS.md`, domain skills → source directory `AGENTS.md` files.
- **Backend detection:** `detectAvailableBackends()` checks if `claude` and `codex` CLIs are installed. `resolveBackend()` picks the best match with fallback.
- **Config persistence:** `.aspens.json` at repo root stores `{ targets, backend, version }`. Read by `doc-sync`, `doc-graph`, `add`, `customize` to know the active target.
- **Codex-only restrictions:** `add agent/command/hook` and `customize agents` throw `CliError` for Codex-only repos (these are Claude Code concepts).
- **Path safety for transforms:** `writeTransformedFiles()` in `skill-writer.js` handles directory-scoped writes (outside `.claude/`); `validateTransformedFiles()` checks for traversal and unexpected filenames.

## Critical Rules
- **Generation always targets Claude format first** — transforms run after generation, never during. The prompts use `{{skillsDir}}`, `{{skillFilename}}`, `{{instructionsFile}}` variables but always receive Claude-target values.
- **`writeTransformedFiles` is separate from `writeSkillFiles`** — transformed files go to source directories (e.g., `src/billing/AGENTS.md`) and use warn-and-skip policy for existing files.
- **Graph artifacts are Claude-only** — `persistGraphArtifacts()` returns serialized data without writing files when `target.supportsGraph === false`.
- **Hooks are Claude-only** — `doc-sync` and `doc-init` skip hook installation when target doesn't support hooks.
- **`readConfig()` returns null if no `.aspens.json`** — callers default to `'claude'` target.

## References
- **Patterns:** See `src/lib/target.js` for all target property definitions

---
**Last Updated:** 2026-04-02
