# aspens

CLI tool that generates and maintains AI-ready documentation (skills + CLAUDE.md) for any codebase. Built with Node.js, ESM, Commander, and Vitest.

## Quick reference

```bash
npm test              # vitest run
npm start             # node bin/cli.js
aspens scan [path]    # detect tech stack, domains, structure
aspens doc init       # generate skills + CLAUDE.md from code
aspens doc sync       # update skills from recent commits
aspens add <type>     # install agents/commands/hooks from template library
aspens customize agents  # inject project context into installed agents
```

## Architecture

```
bin/cli.js              # entry point — Commander program, all subcommands registered here
src/commands/           # command handlers: scan, doc-init, doc-sync, add, customize
src/lib/
  scanner.js            # deterministic repo analysis (languages, frameworks, domains)
  graph-builder.js      # static import graph, domain clusters, hub detection
  context-builder.js    # assembles context payloads for Claude prompts
  runner.js             # Claude CLI execution, stream-json parsing, file output extraction
  skill-writer.js       # writes skill .md files and CLAUDE.md to disk
src/templates/
  agents/               # 9 agent templates (.md)
  commands/             # 2 command templates (.md)
  hooks/                # 2 hook templates (.sh)
  settings/             # settings templates
tests/                   # vitest tests + fixtures
```

## Skills (Claude Code integration)

The project ships as both a CLI and a set of Claude Code skills registered in the system. The seven skill domains are:

| Skill | Description |
|---|---|
| agent-customization | LLM-powered injection of project context into agents |
| claude-runner | Prompt loading, stream-json parsing, file output extraction |
| doc-sync | Maps git diffs to affected skills, optional post-commit hook |
| import-graph | Dependency graphs, domain clusters, hub files, churn hotspots |
| repo-scanning | Language/framework detection, structure mapping, domain discovery |
| skill-generation | LLM generation pipeline for skills and CLAUDE.md |
| template-library | Bundled agents, commands, hooks installed via `aspens add` |

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
- No linter configured yet; `npm run lint` is a no-op
- Dependencies: commander, es-module-lexer, picocolors, @clack/prompts
- Tests live in `tests/` and use vitest — run with `npm test`
