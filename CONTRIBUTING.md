# Contributing to aspens

## Dev Setup

```bash
git clone https://github.com/aspenkit/aspens.git
cd aspens
npm install
node bin/cli.js --help
```

No build step. The CLI runs directly from source (ES modules).

## Project Structure

```
bin/cli.js              # Entry point — commander setup, welcome screen
src/
  commands/
    scan.js             # Tech stack detection output
    doc-init.js         # Skill generation pipeline (3 modes)
    doc-sync.js         # Diff-based skill updates + git hook
    add.js              # Placeholder (Phase 4)
  lib/
    scanner.js          # Deterministic repo scanner (no LLM)
    runner.js           # Claude CLI wrapper, prompt loading, output parsing
    context-builder.js  # Assembles repo context for prompts
    skill-writer.js     # Writes skill files to disk
  prompts/
    doc-init.md         # All-at-once generation prompt
    doc-init-domain.md  # Single domain prompt (chunked mode)
    doc-init-claudemd.md # CLAUDE.md generation prompt
    doc-sync.md         # Sync prompt (diff -> updates)
    partials/           # Shared format specs and examples
```

## Testing

There is no test runner yet. Test manually against real repos:

```bash
node bin/cli.js scan /path/to/repo
node bin/cli.js doc init --dry-run /path/to/repo
```

## Submitting Changes

1. Fork the repo
2. Create a branch (`git checkout -b my-change`)
3. Make your changes
4. Test against at least one real repo
5. Open a PR with a clear description of what changed and why

## Code Style

- **ES modules** — `import`/`export`, no `require()`
- **Path handling** — `path.resolve()` for absolute, `path.relative()` for display
- **UI** — `@clack/prompts` for interactive prompts, `picocolors` for color
- **Error handling** — throw descriptive errors with remediation hints, `process.exit(1)` on unrecoverable failures
- **File reads** — try/catch returning `null` on failure, never throw on missing files
