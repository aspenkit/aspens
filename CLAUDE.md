# aspens

CLI tool that generates and maintains AI-ready documentation (skills + CLAUDE.md) for any codebase. Supports multi-target output (Claude Code, Codex CLI). Built with Node.js, ESM, Commander, and Vitest.

## Quick reference

```bash
npm test              # vitest run
npm start             # node bin/cli.js
aspens scan [path]    # detect tech stack, domains, structure
aspens doc init       # generate skills + hooks + CLAUDE.md
aspens doc sync       # update skills from recent commits
aspens doc graph      # rebuild import graph cache
aspens add <type>     # install agents/commands/hooks from template library
aspens customize agents  # inject project context into installed agents
```

## Architecture

```
bin/cli.js              # entry point — Commander program, CliError handler
src/commands/           # command handlers: scan, doc-init, doc-sync, doc-graph, add, customize
src/lib/
  scanner.js            # deterministic repo analysis (languages, frameworks, domains)
  graph-builder.js      # static import graph, domain clusters, hub detection
  graph-persistence.js  # graph serialization, subgraph extraction, code-map, graph-index
  context-builder.js    # assembles context payloads for Claude prompts
  runner.js             # Claude/Codex CLI execution, stream-json parsing, file output extraction
  skill-writer.js       # writes skill .md files, generates skill-rules.json, merges settings
  skill-reader.js       # parses skill frontmatter, activation patterns, keywords
  diff-helpers.js       # git diff parsing and change extraction
  git-helpers.js        # git operations (log, diff, rev-parse)
  git-hook.js           # post-commit hook install/uninstall for doc-sync
  timeout.js            # timeout calculation (auto-scales by repo size)
  errors.js             # CliError class for structured error handling
  target.js             # target definitions (claude/codex), config persistence (.aspens.json)
  target-transform.js   # content transforms for multi-target output
  backend.js            # backend detection and resolution (claude CLI vs codex CLI)
src/prompts/            # prompt templates + partials/ subdir for reusable fragments
src/templates/
  agents/               # 11 agent templates (.md)
  commands/             # 2 command templates (.md)
  hooks/                # 5 hook templates (.sh + .mjs)
  settings/             # settings templates
tests/                  # vitest tests + fixtures
```

## Skills (Claude Code integration)

The project ships as both a CLI and a set of Claude Code skills registered in the system. The eight skill domains are:

| Skill | Description |
|---|---|
| agent-customization | LLM-powered injection of project context into agents |
| claude-runner | Prompt loading, stream-json parsing, file output extraction, skill rule generation |
| codex-support | Multi-target output — target abstraction, backend routing, content transforms |
| doc-sync | Maps git diffs to affected skills, optional post-commit hook |
| import-graph | Dependency graphs, domain clusters, hub files, churn hotspots, graph persistence |
| repo-scanning | Language/framework detection, structure mapping, domain discovery |
| skill-generation | LLM generation pipeline for skills, hooks, and CLAUDE.md |
| template-library | Bundled agents, commands, hooks, settings installed via `aspens add` |

## Dev docs

Extended dev documentation lives outside this repo at `../dev/`:

- `release.md` — release workflow, publish steps, git tagging, GitHub Discussions
- `roadmap.md` — planned features and direction


## Code review

```bash
cr review --plain   # run CodeRabbit review from CLI
```

Or comment `@coderabbitai review` on any open PR.

## Conventions

- **ESM only** — `"type": "module"` everywhere, no CommonJS
- **Node >= 20** required
- **CliError pattern** — command handlers throw `CliError` (not `process.exit()`); caught at top level in `bin/cli.js`
- **Target/Backend** — Target = where output goes (claude, codex); Backend = which LLM generates content. Config in `.aspens.json`
- No linter configured yet; `npm run lint` is a no-op
- Dependencies: commander, es-module-lexer, picocolors, @clack/prompts
- Tests live in `tests/` and use vitest — run with `npm test`
