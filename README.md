<div align="center">

<img src="aspens-logo.png" alt="aspens" width="120" />

# aspens

## Prevent stale agent context.

### For Claude Code and Codex

[![npm version](https://img.shields.io/npm/v/aspens.svg)](https://www.npmjs.com/package/aspens)
[![npm downloads](https://img.shields.io/npm/dm/aspens.svg)](https://www.npmjs.com/package/aspens)
[![GitHub stars](https://img.shields.io/github/stars/aspenkit/aspens)](https://github.com/aspenkit/aspens)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Stop re-explaining your repo to Claude Code and Codex.
Aspens keeps both aligned with your actual codebase.
It scans the repo, generates project-specific instructions and skills, and keeps them fresh as the code evolves.

</div>

---

**One-line pitch**

Repo context for coding agents that does not go stale.

**Why it matters**

| Without aspens | With aspens |
|---|---|
| Agents miss conventions and architectural boundaries | Agents start from repo-specific instructions |
| New sessions waste time rediscovering key files | Skills point to the right files, patterns, and rules |
| Context files drift after code changes | Aspens syncs them from the codebase |
| Teams keep correcting the same mistakes manually | Critical conventions and anti-patterns stay in generated context |

---

**Start here**

```bash
npx aspens doc init --recommended .
npx aspens doc impact .
```

Generate context, then verify it is fresh and covering the repo.

![aspens demo](demo/demo-full.gif)

**What aspens does**

- `Scan` the repo to find domains, hub files, and structure
- `Generate` instructions and skills for Claude Code, Codex, or both
- `Sync` generated context as the codebase changes
- `Prove` coverage and freshness with `aspens doc impact`

**What are skills?** Concise markdown files that give coding agents the context they need to write correct code: key files, patterns, conventions, and critical rules.

## Quick Start

```bash
npx aspens scan .                    # Map the repo
npx aspens doc init --recommended .  # Generate the recommended context setup
npx aspens doc impact .              # Verify freshness and coverage
npx aspens doc sync --install-hook   # Keep generated context synced on every commit
```

Requires [Node.js 20+](https://nodejs.org) and at least one supported backend CLI such as [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) or Codex CLI.

## Target Support

Aspens supports multiple agent environments through output targets:

- `claude`: `CLAUDE.md` + `.claude/skills` + Claude hooks
- `codex`: `AGENTS.md` + `.agents/skills` + directory `AGENTS.md`
- `all`: generate both sets together

Use `claude` if you want hooks plus docs.
Use `codex` if you want instruction files plus skills.
Use `all` if your team works across both.

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

Map the repo before generating anything. `scan` is deterministic: it detects tech stack, domains, hub files, coupling, and hotspots without calling an LLM.

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

Generate agent context from the repo itself. `doc init` scans the codebase, discovers the architecture and feature domains, then writes instructions and skills for Claude, Codex, or both.

For the lowest-friction setup, use:

```bash
aspens doc init --recommended .
```

`--recommended` is the fastest path:

- reuses existing target config when present
- defaults to improving existing docs instead of prompting
- auto-picks the generation mode based on repo size

What it does:
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
| `--recommended` | Use the recommended target, strategy, and generation mode |

### `aspens doc impact [path]`

Show whether your generated context is still keeping up with the codebase. This is the proof surface: are the docs present, covering the right domains, surfacing the right hub files, and fresher than the repo changes?

Checks:
- instructions and skills present per target
- domain coverage vs detected repo domains
- top hub files surfaced in root guidance
- whether generated context is older than the newest source changes

```bash
$ aspens doc impact .

  my-app

  Claude Code
    Instructions: present (CLAUDE.md)
    Skills: 9
    Domain coverage: 8/9, missing onboarding
    Hub files surfaced: 4/5
    Hooks: installed
    Last updated: Apr 7, 2026, 9:41 AM  stale vs source
```

### `aspens doc sync [path]`

Keep generated context from drifting. `doc sync` reads recent git changes, maps them to affected skills and instructions, and updates only what changed.

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
