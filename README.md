<div align="center">

<img src="aspens-logo.png" alt="aspens" width="120" />

# aspens

## Stop re-explaining your repo. Start shipping.

[![npm version](https://img.shields.io/npm/v/aspens.svg)](https://www.npmjs.com/package/aspens)
[![npm downloads](https://img.shields.io/npm/dm/aspens.svg)](https://www.npmjs.com/package/aspens)
[![GitHub stars](https://img.shields.io/github/stars/aspenkit/aspens)](https://github.com/aspenkit/aspens)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Claude, Codex, and other coding agents write better code when they start with the right repo context.
Aspens scans your repo, discovers what matters, and generates context that stays updated on every commit — so each session starts on track.

</div>

---

**Why aspens?**

| Without aspens | With aspens |
|---|---|
| Agents ignore your conventions | Claude and Codex start with repo-specific instructions |
| Agents rebuild things that already exist | Skills and docs point them to the right abstractions |
| You manually maintain AI context files | Aspens generates and updates them for you |
| Agents spend half their tool calls searching for files | Import graph tells them which files actually matter |
| Your codebase gets fragmented and inconsistent over time | Domain-specific skills with critical rules and anti-patterns |
| Burns through tokens searching, reading, and rebuilding | Your AI tools already know what matters — dramatically fewer tool calls |

---

```bash
npx aspens doc init .
```

![aspens demo](demo/demo-full.gif)

**What are skills?** Concise markdown files (~35 lines) that give coding agents the context they need to write correct code: key files, patterns, conventions, and critical rules.

## Quick Start

```bash
npx aspens scan .                    # See what's in your repo
npx aspens doc init .                # Generate repo docs for the active target
npx aspens doc init --target codex   # Generate AGENTS.md + .agents/skills
npx aspens doc sync --install-hook   # Auto-update generated docs on every commit
```

Requires [Node.js 20+](https://nodejs.org) and at least one supported backend CLI such as [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) or Codex CLI.

## Target Support

Aspens supports different AI tools through different output targets:

- `claude`: `CLAUDE.md` + `.claude/skills` + Claude hooks
- `codex`: `AGENTS.md` + `.agents/skills` + directory `AGENTS.md`
- `all`: generate both sets together

Short version:

- Claude support is hook-aware and document-aware
- Codex support is document-driven, not hook-driven

Important distinction:

- Claude activation hooks are Claude-only
- The git post-commit `aspens doc sync` hook works for all configured targets

If your repo already has Claude docs and you want to add Codex, you do not need to start from zero:

```bash
aspens doc init --target codex
```

Or regenerate both targets together:

```bash
aspens doc init --target all
```

See [docs/target-support.md](docs/target-support.md) for the full target model and migration notes.

## Commands

### `aspens scan [path]`

Detect tech stack, frameworks, structure, and domains. Builds an import graph to identify hub files, domain coupling, and hotspots. No LLM calls — pure file system + git inspection.

```
$ aspens scan .

  my-app (fullstack)
  /Users/you/my-app

  Languages: typescript, javascript
  Frameworks: nextjs, react, tailwind, prisma
  Entry points: src/index.ts

  Structure
    src/ ← source root
    tests/

  Key directories
    components → src/components/
    services → src/services/
    database → prisma/

  Import Graph (247 files, 892 edges)
    Hub files:
      src/lib/db.ts              ← 31 dependents, 2 exports
      src/auth/middleware.ts      ← 18 dependents, 3 exports
      src/lib/api-client.ts      ← 15 dependents, 4 exports

  Domains (by imports)
    components (src/components/) — 89 files
      → depends on: lib, hooks, types
    lib (src/lib/) — 12 files
      ← depended on by: components, services, hooks

  Coupling
    components → lib    45 imports
    hooks → lib         23 imports

  Hotspots (high churn, last 6 months)
    src/auth/session.ts — 19 changes, 210 lines

  Claude Code
    .claude/ no  CLAUDE.md no
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--domains <list>` | Additional domains to include (comma-separated) |
| `--no-graph` | Skip import graph analysis |
| `--verbose` | Show diagnostic output |

### `aspens doc init [path]`

Generate repo docs for Claude, Codex, or both. Runs parallel discovery calls through the selected backend to understand your architecture, then generates skills/docs based on what it found.

The flow:
1. **Scan + Import Graph** — builds dependency map, finds hub files
2. **Parallel Discovery** — 2 backend-guided discovery passes explore simultaneously (domains + architecture)
3. **User picks domains** — from the discovered feature domains
4. **Parallel Generation** — generates 3 domain skills at a time

Claude-target example:

```
$ aspens doc init .

  ◇ Scanned my-app (fullstack)

    Languages: typescript, javascript
    Frameworks: nextjs, react, tailwind, prisma
    Source modules: components, lib, hooks, services, types
    Import graph: 247 files, 892 edges
    Size: 247 source files (medium)
    Timeout: 300s per call

    Running 2 discovery agents in parallel...

  ◇ Discovery complete
    Architecture: Layered frontend (Next.js 16 App Router)
    Discovered 8 feature domains:
      auth — User authentication, session management
      courses — AI-powered course generation
      billing — Stripe subscriptions, usage limits
      profile — User profile, XP, badges
      ...

  ◆ 8 domains detected. Generate skills:
  ● One domain at a time
  ○ Pick specific domains
  ○ Base skill only

  ◇ Base skill generated
  ◇ auth, courses, billing
  ◇ profile, settings, onboarding
  ◇ layout, landing

  + .claude/skills/base/skill.md
  + .claude/skills/auth/skill.md
  + .claude/skills/courses/skill.md
  ...

  11 call(s) | ~23,640 prompt | 35,180 output | 161 tool calls | 4m 32s

  10 created
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without writing files |
| `--force` | Overwrite existing skills |
| `--timeout <seconds>` | Backend timeout (default: 300) |
| `--mode <mode>` | `all`, `chunked`, or `base-only` (skips interactive prompt) |
| `--strategy <strategy>` | `improve`, `rewrite`, or `skip` for existing docs (skips interactive prompt) |
| `--domains <list>` | Additional domains to include (comma-separated) |
| `--no-graph` | Skip import graph analysis |
| `--model <model>` | Model for the selected backend |
| `--verbose` | Show backend reads/activity in real time |
| `--target <target>` | Output target: `claude`, `codex`, or `all` |
| `--backend <backend>` | Generation backend: `claude` or `codex` |

### `aspens doc sync [path]`

Update generated docs based on recent git commits. Reads the diff, maps changes to affected docs, and updates only what changed.

If your repo is configured for multiple targets, `doc sync` updates all configured outputs from one run. Claude activation hooks remain Claude-only, but the git post-commit sync hook can keep both Claude and Codex docs current.

```
$ aspens doc sync .

  ◆ aspens doc sync

  ◇ 4 files changed

    src/services/billing/stripe.ts
    src/services/billing/usage.ts
    src/components/billing/PricingPage.tsx
    package.json

  ℹ Skills that may need updates: billing, base

  ◇ Analyzing changes and updating skills...
  ◇ 1 file(s) to update

  ~ .claude/skills/billing/skill.md

  1 file(s) updated
```

| Option | Description |
|--------|-------------|
| `--commits <n>` | Number of commits to analyze (default: 1) |
| `--refresh` | Review all skills against current codebase (no git diff needed) |
| `--no-graph` | Skip import graph analysis |
| `--install-hook` | Install git post-commit auto-sync for all configured targets |
| `--remove-hook` | Remove the git post-commit auto-sync hook |
| `--dry-run` | Preview without writing files |
| `--timeout <seconds>` | Backend timeout (default: 300) |
| `--model <model>` | Model for the selected backend |
| `--verbose` | Show backend reads/activity in real time |

### `aspens doc graph [path]`

Rebuild the import graph cache. Runs automatically during `doc init` and `doc sync`, but you can trigger it manually.

```bash
aspens doc graph .
```

### `aspens add <type> [name]`

Add individual components from the bundled library, or create custom skills.

```bash
aspens add agent all              # Add all 11 AI agents
aspens add agent code-reviewer    # Add a specific agent
aspens add agent --list           # Browse available agents
aspens add hook skill-activation  # Add auto-triggering hooks
aspens add command dev-docs       # Add slash commands
aspens add skill my-convention    # Scaffold a custom skill
aspens add skill release --from dev/release.md  # Generate from a reference doc
aspens add skill --list           # Show existing skills
```

| Option | Description |
|--------|-------------|
| `--list` | Browse available components |
| `--from <file>` | Generate a skill from a reference document (skills only) |
| `--force` | Overwrite existing skills |

### `aspens customize agents`

Inject your project's tech stack, conventions, and file paths into installed Claude agents. Reads your skills and `CLAUDE.md`, then tailors each agent with project-specific context.

```bash
aspens customize agents           # Customize all installed agents
aspens customize agents --dry-run # Preview changes
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without writing files |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--model <model>` | Claude model (e.g., sonnet, opus, haiku) |
| `--verbose` | Show what Claude is doing |

## How It Works

```
Your Repo ──▶ Scanner ──▶ Import Graph ──▶ Discovery Passes ──▶ Skill Generation
               (detect     (parse imports,   (2 parallel backend   (3 domains at a
               stack,       hub files,         calls: domains +     time, guided by
               domains)     coupling)          architecture)        graph + findings)
```

1. **Scanner** detects your tech stack, frameworks, structure, and domains. Deterministic — no LLM, instant, free.
2. **Import Graph** parses imports across JS/TS/Python, resolves `@/` aliases from tsconfig, builds a dependency map with hub files, coupling analysis, git churn hotspots, and file priority ranking.
3. **Discovery Passes** (2 parallel backend calls) explore the codebase guided by the graph. One discovers feature domains, the other analyzes architecture and patterns. Results are merged.
4. **Skill Generation** uses the graph + discovery findings to write concise, actionable skills. Runs up to 3 domains in parallel.

Doc sync keeps skills current: on each commit, it reads the diff, identifies affected skills, and updates them.

## What a Skill Looks Like

```markdown
---
name: billing
description: Stripe billing integration — subscriptions, usage tracking, webhooks
---

## Activation

This skill triggers when editing billing/payment-related files:
- `**/billing*.ts`
- `**/stripe*.ts`

---

You are working on **billing, Stripe integration, and usage limits**.

## Key Files
- `src/services/billing/stripe.ts` — Stripe SDK wrapper
- `src/services/billing/usage.ts` — Usage counters and limit checks

## Key Concepts
- **Webhook-driven:** Subscription state changes come from Stripe webhooks, not API calls
- **Usage gating:** `checkLimit(userId, type)` returns structured 429 error data

## Critical Rules
- Webhook endpoint has NO auth middleware — verified by Stripe signature only
- Cancel = `cancel_at_period_end: true` (user keeps access until period end)
```

~35 lines. This is the kind of focused context aspens generates for agent-specific docs.

## Save Tokens

Without context, coding agents burn through usage searching for files, reading code they don't need, and rebuilding things that already exist. With aspens, they know your codebase structure before writing a single line — fewer tool calls, fewer wasted reads, fewer rewrites.

Less context searching. More code shipping.

## Requirements

- **Node.js 20+**
- **Claude Code CLI** for Claude-target generation — `npm install -g @anthropic-ai/claude-code`
- **Codex CLI** for Codex-target generation

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
