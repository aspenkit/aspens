# Contributing to aspens

## Prerequisites

- [Node.js 18+](https://nodejs.org)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (needed for `doc init`, `doc sync`, and `customize` commands)
- Git

## Setup

```bash
# 1. Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/aspens.git
cd aspens
npm install

# 2. Verify it works
node bin/cli.js --help
npm test
```

No build step. The CLI runs directly from source (ES modules).

## Testing Your Changes Locally

### Run the test suite

```bash
npm test                          # Run all tests
npx vitest run tests/scanner.test.js  # Run a single test file
npx vitest --watch                # Watch mode during development
```

### Test against a real repo

The best way to verify your changes is to run aspens against an actual codebase.

**Option 1: `npm link` (recommended)**

Link your local aspens globally so you can use it like the published package:

```bash
# In the aspens directory:
npm link

# Now test from any repo:
cd /path/to/some-project
aspens scan .
aspens doc init --dry-run .
```

When you're done, unlink:

```bash
npm unlink -g aspens
```

**Option 2: Run directly**

```bash
node /path/to/aspens/bin/cli.js scan /path/to/some-project
```

**Option 3: Use `--dry-run`**

Most write commands support `--dry-run` to preview output without touching files:

```bash
node bin/cli.js doc init --dry-run /path/to/some-project
node bin/cli.js doc sync --dry-run /path/to/some-project
```

## Code Review with CodeRabbit

We use [CodeRabbit](https://coderabbit.ai) for automated code review on every PR. Here's what to expect:

- **Automatic review** — CodeRabbit reviews your PR when you open it and on each push. No action needed from you.
- **Summary comment** — It posts a walkthrough summarizing your changes, sequence diagrams, and a file-by-file breakdown.
- **Inline suggestions** — It may leave inline comments with improvement suggestions. You can reply to these directly.
- **Chat commands** — You can interact with CodeRabbit in PR comments:
  - `@coderabbitai resolve` — Mark a suggestion as resolved
  - `@coderabbitai summary` — Regenerate the summary
  - `@coderabbitai review` — Request a re-review after changes

Don't worry about "passing" CodeRabbit — the review profile is set to **chill**. It's there to catch things, not block you. A maintainer will do the final review.

## Submitting a Pull Request

1. Fork the repo and create a branch (`git checkout -b my-change`)
2. Make your changes
3. Run the tests (`npm test`)
4. Test against at least one real repo (see above)
5. Open a PR with a clear description of what changed and why

### What makes a good PR

- **Small and focused** — one feature or fix per PR
- **Tests included** — add or update tests in `tests/` for any logic changes
- **Tested against a real repo** — mention which repo you tested with in the PR description

## Project Structure

```
bin/cli.js              # Entry point — Commander setup, welcome screen
src/
  commands/
    scan.js             # Tech stack detection output
    doc-init.js         # Skill generation pipeline (3 modes)
    doc-sync.js         # Diff-based skill updates + git hook
    add.js              # Add individual components
    customize.js        # Inject project context into agents
  lib/
    scanner.js          # Deterministic repo scanner (no LLM)
    graph-builder.js    # Import graph construction
    context-builder.js  # Assembles repo context for prompts
    runner.js           # Claude CLI wrapper, stream parsing
    skill-writer.js     # Writes skill files to disk
  prompts/              # Markdown prompt templates
    partials/           # Shared format specs
  templates/            # Bundled components (agents, hooks, commands)
tests/                  # Vitest test files
```

## Code Style

- **ES modules** — `import`/`export`, no `require()`
- **Path handling** — `path.resolve()` for absolute, `path.relative()` for display
- **UI** — `@clack/prompts` for interactive prompts, `picocolors` for color
- **Error handling** — throw descriptive errors with remediation hints, `process.exit(1)` on unrecoverable failures
- **File reads** — try/catch returning `null` on failure, never throw on missing files

## Where to Start

Look for issues labeled [`good first issue`](https://github.com/aspenkit/aspens/labels/good%20first%20issue) — these are scoped, well-described tasks ideal for first-time contributors.

If you have an idea but aren't sure where to start, open an issue first to discuss it.
