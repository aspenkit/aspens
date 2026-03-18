# Copilot Instructions

## What This Project Does

`aspens` is a CLI tool that generates and maintains AI-ready documentation (skills and guidelines) for any codebase. It scans a repo's tech stack, then uses Claude to produce structured markdown "skill files" that Claude Code loads automatically when working in that codebase.

```bash
aspens scan                        # detect tech stack (current dir)
aspens doc init --dry-run          # preview generated skills
aspens doc init --mode chunked     # generate one domain at a time
aspens doc sync --commits 3        # update skills from last 3 commits
aspens doc sync --install-hook     # auto-sync on every commit
```

## Project Setup

```bash
npm install   # installs commander, @clack/prompts, picocolors
npm link      # makes `aspens` available globally for testing
```

No build step. No test runner configured yet — `tests/` is empty.

## Architecture

```
bin/cli.js              # entrypoint — welcome screen + subcommands via commander
src/
  index.js              # barrel exports
  commands/
    scan.js             # pretty/JSON output of scanner results
    doc-init.js         # full pipeline: scan → mode select → Claude → write
    doc-sync.js         # diff-based skill updates + git hook installer
    add.js              # placeholder (Phase 4)
  lib/
    scanner.js          # deterministic tech stack detection (no LLM)
    context-builder.js  # assembles repo context (used by doc-sync, available for API mode)
    runner.js           # wraps `claude -p` CLI; prompt loading; output parsing; path sanitization
    skill-writer.js     # writes parsed {path, content} files to disk
  prompts/
    doc-init.md         # all-at-once init prompt (tool-first: "read before writing")
    doc-init-domain.md  # single domain skill prompt (for chunked mode)
    doc-init-claudemd.md # CLAUDE.md generation prompt
    doc-sync.md         # sync prompt (diff → skill updates)
    partials/           # skill-format.md, guideline-format.md, examples.md
```

### `doc init` Pipeline

1. `scanRepo()` — detect languages, frameworks, structure, domains, entry points
2. User picks mode: all-at-once / chunked / pick domains / base-only
3. User picks strategy for existing docs: improve / rewrite / skip
4. `loadPrompt()` — resolve `{{partial-name}}` and `{{varName}}` in the template
5. `runClaude()` — spawn `claude -p` with `--allowedTools Read,Glob,Grep` — Claude explores the repo itself
6. `parseFileOutput()` — extract `<file path="...">content</file>` blocks from Claude's response
7. `writeSkillFiles()` — mkdir + write, respecting `--force` / `--dry-run`

### `doc sync` Pipeline

1. Check prerequisites (git repo, .claude/skills/ exists)
2. Get git diff for last N commits
3. Map changed files → affected skills (via activation pattern matching, generic segments filtered)
4. Send diff + existing skills to Claude with Read/Glob/Grep tools
5. Claude updates only affected skills, outputs nothing if no changes needed
6. Write updated files (force mode — sync is meant to be automated)

## Key Conventions

### ES Modules
The project uses `"type": "module"` — all files use `import`/`export`, no `require()`.

### Path Handling
Always resolve to absolute paths with `path.resolve()` / `path.join()`. Use `path.relative()` for display and stored paths. Never pass raw user-provided paths without resolving first.

### Output Parsing
Claude emits files as `<file path="...">content</file>`. `parseFileOutput()` handles this (primary) and an HTML comment fallback. Paths are validated by `sanitizePath()`: no `..`, no leading `/`, must be exactly `CLAUDE.md` or start with `.claude/`.

### Prompt Templates
Templates live in `src/prompts/`. `{{skill-format}}` in a template resolves to the full content of `src/prompts/partials/skill-format.md`. Other `{{varName}}` tokens are substituted from the `vars` object passed to `loadPrompt()`. Partials are resolved before variables.

### Claude CLI Invocation
`runner.js` spawns `claude -p` with `--allowedTools Read,Glob,Grep` — read-only tools so Claude can explore the codebase. For `--verbose` mode, uses `--output-format stream-json` to show real-time activity. Handles timeout (manual timer + SIGTERM), rate-limit detection, and non-zero exits.

### Interactive UI
Use `@clack/prompts` for all user-facing interaction (spinners, confirms, selects, multiselects). Use `picocolors` for inline color. `--mode` and `--strategy` flags allow non-interactive/CI usage.

### Error Handling
Throw descriptive errors with remediation hints. Commands call `process.exit(1)` on unrecoverable failures. File reads use try/catch and return `null` on failure. Doc init falls back to chunked mode on timeout.

## Skill File Format

Generated skills use YAML frontmatter followed by structured markdown:

```markdown
---
name: domain-name
description: One-line description
---

## Activation
Triggers when editing these files:
- `**/pattern*.js`

---

You are working on **description**.

## Key Files
## Key Concepts
## Critical Rules
```

Skills are written to `.claude/skills/<name>/skill.md` in the target repo. The full spec is in `src/prompts/partials/skill-format.md`.

## Phase Status

| Phase | Status |
|-------|--------|
| 1: Scanner + Skill Format | Done |
| 2: Doc Init (3 modes, improve/rewrite/skip, verbose, chunked) | Done |
| 3: Doc Sync (git diff, skill mapping, hook installer) | Done |
| 4: À La Carte Components | Planned |
| 5: API Mode (Anthropic SDK) | Planned |
| 6: Docs Site (Astro Starlight) | Planned |
| 7: Launch (npm publish) | Planned |
