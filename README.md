<div align="center">

<img src="aspens-logo.png" alt="aspens" width="120" />

# aspens

### Stop correcting Claude. Start shipping.

[![npm version](https://img.shields.io/npm/v/aspens.svg)](https://www.npmjs.com/package/aspens)
[![npm downloads](https://img.shields.io/npm/dm/aspens.svg)](https://www.npmjs.com/package/aspens)
[![GitHub stars](https://img.shields.io/github/stars/aspenkit/aspens)](https://github.com/aspenkit/aspens)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Claude Code writes code that ignores your patterns, uses wrong abstractions, and breaks your rules.
Aspens scans your repo, discovers what matters, and generates context that stays updated on every commit — so every Claude Code session starts on track.

</div>

---

**Why aspens?**

| Without aspens | With aspens |
|---|---|
| Claude ignores your conventions | Claude follows your patterns from the first prompt |
| Claude builds components from scratch instead of reusing yours | Skills tell Claude exactly what exists and where |
| You manually write and maintain CLAUDE.md | Skills auto-generated and updated on every commit |
| Claude spends half its tool calls Bash/Grep searching for files | Import graph tells Claude which files actually matter |
| Your codebase gets fragmented and inconsistent over time | Domain-specific skills with critical rules and anti-patterns |
| Burns through tokens searching, reading, and rebuilding | Claude already knows what matters — dramatically fewer tool calls |

---

```bash
npx aspens doc init .
```

![aspens demo](demo/demo-full.gif)

**What are skills?** Concise markdown files (~35 lines) that Claude Code loads automatically when you work in specific parts of your codebase. They give Claude the context it needs to write correct code — key files, patterns, conventions, critical rules.

## Quick Start

```bash
npx aspens scan .                    # See what's in your repo
npx aspens doc init .                # Generate skills + CLAUDE.md
npx aspens doc sync --install-hook   # Auto-update on every commit
```

Requires [Node.js 20+](https://nodejs.org) and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code).

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
| `--verbose` | Show diagnostic output |

### `aspens doc init [path]`

Generate skills and CLAUDE.md. Runs parallel discovery agents to understand your architecture, then generates skills based on what it found.

The flow:
1. **Scan + Import Graph** — builds dependency map, finds hub files
2. **Parallel Discovery** — 2 Claude agents explore simultaneously (domains + architecture)
3. **User picks domains** — from the discovered feature domains
4. **Parallel Generation** — generates 3 domain skills at a time

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
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--mode <mode>` | `all`, `chunked`, or `base-only` (skips interactive prompt) |
| `--strategy <strategy>` | `improve`, `rewrite`, or `skip` for existing docs (skips interactive prompt) |
| `--domains <list>` | Additional domains to include (comma-separated) |
| `--model <model>` | Claude model (e.g., sonnet, opus, haiku) |
| `--verbose` | Show what Claude is reading in real time |

### `aspens doc sync [path]`

Update skills based on recent git commits. Reads the diff, maps changes to affected skills, and has Claude update only what changed.

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
| `--install-hook` | Install git post-commit hook for auto-sync |
| `--remove-hook` | Remove the post-commit hook |
| `--dry-run` | Preview without writing files |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--model <model>` | Claude model (e.g., sonnet, opus, haiku) |
| `--verbose` | Show what Claude is reading in real time |

### `aspens doc graph [path]`

Rebuild the import graph cache. Runs automatically during `doc init` and `doc sync`, but you can trigger it manually.

```bash
aspens doc graph .
```

### `aspens add <type> [name]`

Add individual components from the bundled library, or create custom skills.

```bash
aspens add agent all              # Add all 9 AI agents
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

### `aspens customize agents`

Inject your project's tech stack, conventions, and file paths into installed agents. Reads your skills and CLAUDE.md, then tailors each agent with project-specific context.

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
Your Repo ──▶ Scanner ──▶ Import Graph ──▶ Discovery Agents ──▶ Skill Generation
               (detect     (parse imports,   (2 parallel Claude   (3 domains at a
               stack,       hub files,         agents: domains +    time, guided by
               domains)     coupling)          architecture)        graph + findings)
```

1. **Scanner** detects your tech stack, frameworks, structure, and domains. Deterministic — no LLM, instant, free.
2. **Import Graph** parses imports across JS/TS/Python, resolves `@/` aliases from tsconfig, builds a dependency map with hub files, coupling analysis, git churn hotspots, and file priority ranking.
3. **Discovery Agents** (2 parallel Claude calls) explore the codebase guided by the graph. One discovers feature domains, the other analyzes architecture and patterns. Results are merged.
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

~35 lines. This is what Claude reads when you touch billing files.

## Save Tokens

Without context, Claude burns through your usage searching for files, reading code it doesn't need, and rebuilding things that already exist. With aspens, Claude knows your codebase structure before it writes a single line — fewer tool calls, fewer wasted reads, fewer rewrites.

Less context searching. More code shipping.

## Requirements

- **Node.js 20+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
