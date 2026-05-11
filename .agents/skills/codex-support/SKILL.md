---
name: codex-support
description: Multi-target output system — target abstraction, backend routing, content transforms for Codex CLI and future targets
triggers:
  files:
    - src/lib/target.js
    - src/lib/target-transform.js
    - src/lib/backend.js
    - AGENTS.md
    - .aspens.json
  keywords:
    - codex
    - target
    - backend
    - AGENTS.md
    - .aspens.json
    - sanitize
    - transform
    - multi-target
    - parity
---

---

You are working on **multi-target output support** — the system that lets aspens generate documentation for Claude Code, Codex CLI, or both simultaneously.

## Key Concepts
- **Target vs Backend:** Target = where output goes (claude → `.claude/skills/`, codex → `.agents/skills/` + directory-scoped `AGENTS.md`). Backend = which LLM CLI generates the content (`claude -p` or `codex exec`).
- **Target definitions:** `TARGETS.claude` (centralized) and `TARGETS.codex` (directory-scoped). Each defines paths and capability flags: `supportsHooks`, `supportsSettings`, `supportsGraph`, `supportsSkills`, `needsActivationSection`, `needsCodeMapEmbed`, `supportsMCP`. Codex also has `maxInstructionsBytes` (32 KiB) and `userSkillsDir`. Codex's `needsCodeMapEmbed` is `false` — condensed cluster/framework data goes into the synthetic `.agents/skills/architecture/` skill instead of the root AGENTS.md.
- **Canonical generation:** Generation always produces Claude-canonical format first. Prompts always receive `CANONICAL_VARS` (hardcoded Claude paths from `doc-init.js`). Transforms run **after** generation to produce other target formats.
- **Content transform:** `transformForTarget()` remaps paths and content. For Codex: base skill → root `AGENTS.md`, domain skills → both `.agents/skills/{domain}/SKILL.md` and source directory `AGENTS.md`. `generateCodexSkillReferences()` creates `.agents/skills/architecture/` with code-map data.
- **Skills section completeness:** `collectSkillsForList()` (internal) reads every skill from disk under `sourceTarget.skillsDir` and overlays pending in-flight changes (`files` passed to the transform) so the root instructions file's `## Skills` section always lists every on-disk skill — not just the subset that changed in this sync. Pending changes win for descriptions; on-disk content survives for unchanged skills.
- **Instructions file disk fallback:** `transformToDirectoryScoped` loads `instructionsFile` from disk via `repoPath` context parameter when it's not in the canonical files array (e.g., during `doc init --strategy skip-existing` or incremental `doc sync`). Uses a single `readFileSync` from `fs` wrapped in try/catch (no separate `existsSync` check).
- **Content sanitization:** `sanitizeCodexInstructions()` and `sanitizeCodexSkill()` strip Claude-specific references (hooks, skill-rules.json, Claude Code mentions) from Codex output.
- **`sanitizePublishedContent(content, filePath)`** — Single-chokepoint sanitizer invoked by `skill-writer.js` on every disk write. Always strips `## Activation` blocks and `## Key Files` blocks. Outside `code-map.md`, also strips count-bearing blocks: `**Hub files…**`, `**Domain clusters:**`, `**High-churn hotspots:**`, `**Framework entry points…**`. Defense in depth — upstream leaks can't reach the user.
- **Skills-variant stripping:** `syncSkillsSection()` removes LLM-emitted Skill-section variants (`## Skills Reference`, `## Skills Overview`, etc.) before injecting the canonical `## Skills` list. Doc-init and doc-sync prompts also forbid such headings.
- **`ensureRootKeyFilesSection(content, graphSerialized)`** — Post-processes root instructions file to guarantee a `## Key Files` section with top hub files from the graph.
- **`mergeConfiguredTargets(existing, next)`** — Merges target arrays to avoid dropping previously configured targets during narrower runs. Validates against `TARGETS` keys, deduplicates.
- **`getAllowedPaths(targets)`** — Returns `{ dirPrefixes, exactFiles }` union across all active targets.
- **Backend detection:** `detectAvailableBackends()` checks if `claude` and `codex` CLIs are installed. `resolveBackend()` picks best match: explicit flag > target match > fallback.
- **Config persistence:** `.aspens.json` at repo root stores `{ targets, backend, version, saveTokens? }`. `readConfig()` returns `null` if missing **or if the config is structurally invalid**. `isValidConfig()` validates targets, backend, version, and `saveTokens` (via `isValidSaveTokensConfig()`).
- **`loadConfig(repoPath, { persist })`** — Reads `.aspens.json` and, if missing, recovers via `inferConfig()` from on-disk artifacts. Returns `{ config, recovered }`. Persists inferred config to disk by default unless `persist: false` is passed.
- **Feature config (`saveTokens`):** Optional object in `.aspens.json` validated by `isValidSaveTokensConfig()` — checks `enabled` (boolean), `warnAtTokens`/`compactAtTokens` (positive integers, compact > warn unless either is `MAX_SAFE_INTEGER`), `saveHandoff`/`sessionRotation` (booleans), optional `claude`/`codex` sub-objects with `enabled` and `mode`.
- **`writeConfig` preserves feature config:** `writeConfig()` reads existing config and merges — `saveTokens` preserved unless explicitly set to `null` (intentional removal) or `undefined` (keep existing). Targets and backend also merge with existing.
- **Multi-target publish:** `doc-sync` uses `publishFilesForTargets()` to generate output for all configured targets from a single LLM run. `repoPath` is passed through to the transform context.
- **Codex inference tightened:** `inferConfig()` only adds `'codex'` to inferred targets when `.codex/` config dir or `.agents/skills/` dir exists.
- **Conditional architecture ref:** Codex `buildCodexSkillRefs()` only includes the architecture skill reference when a graph was actually serialized.
- **Architecture skill is codex-only synthetic:** The codex `architecture` skill is generated from graph data and has no Claude counterpart by design. `logicalKeyForFile()` returns `null` for codex `architecture` paths so `assertTargetParity()` won't raise a parity violation for the missing Claude side.

## Critical Rules
- **Generation always targets Claude canonical format first** — transforms run after, never during. Prompts always receive `CANONICAL_VARS`.
- **Split write logic:** `writeSkillFiles()` handles direct-write files. `writeTransformedFiles()` handles directory-scoped `AGENTS.md` with an explicit path allowlist and warn-and-skip policy. Both writers run their payloads through `sanitizePublishedContent` before touching disk.
- **Path safety:** `validateTransformedFiles()` rejects absolute paths, traversal, and unexpected filenames. `writeTransformedFiles()` enforces the same checks.
- **Codex-only restrictions:** `add agent/command/hook` and `customize agents` throw `CliError` for Codex-only repos. `add skill` works for both targets.
- **Graph/hooks are Claude-only** — `persistGraphArtifacts()` returns data without writing files when `target.supportsGraph === false`. Hook installation skipped when `supportsHooks === false`.
- **Config validation is defensive** — `readConfig()` treats malformed but parseable JSON (e.g., wrong types for `targets`/`backend`/`version`/`saveTokens`) as invalid and returns `null`, same as missing config.
- **`repoPath` context is required for disk fallback** — callers of `transformForTarget` must pass `repoPath` in the context object for `instructionsFile` to load from disk when not in canonical files, and for `collectSkillsForList` to enumerate on-disk skills.

## References
- **Patterns:** See `src/lib/target.js` for all target property definitions

---
**Last Updated:** 2026-05-11
