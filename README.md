<div align="center">

<img src="aspens-logo.png" alt="aspens" width="120" />

# aspens

**Your CLAUDE.md stopped working. Here's why.**

[![npm version](https://img.shields.io/npm/v/aspens.svg)](https://www.npmjs.com/package/aspens)
[![npm downloads](https://img.shields.io/npm/dt/aspens.svg)](https://www.npmjs.com/package/aspens)
[![GitHub stars](https://img.shields.io/github/stars/aspenkit/aspens)](https://github.com/aspenkit/aspens)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

You started with 50 clean lines. Three months later it's 200, and Claude ignores half of them. Adding more rules doesn't fix it. The file got too big for the agent to follow, and it goes stale every time the code changes.

aspens replaces the monolith with scoped skill files (~35 lines each) generated from your actual import graph. Each skill activates only when the agent touches that part of the codebase. A post-commit hook keeps them in sync automatically. The agent reads 35 focused lines instead of 200 sprawling ones, and actually follows them.

Works with Claude Code, Codex, or both.

```bash
npx aspens doc init --recommended
```

Then verify what it generated:

```bash
npx aspens doc impact
```

![aspens demo](demo/demo-full.gif)

## Before / After

**Before aspens** — one file tries to cover everything:
- Agent starts cold, spends 10-20 tool calls exploring your codebase every session
- CLAUDE.md grows until the agent stops following it
- Documentation drifts out of date within days of any refactor
- Agent misses conventions, duplicates existing code, ignores architectural boundaries

**After aspens** — scoped skills generated from your import graph:
- Agent loads only the skill for the domain it's working in (~35 lines, 100% followed)
- `doc sync` updates affected skills automatically on every commit
- `doc impact` proves freshness and coverage so you know context matches the code
- Agent reuses existing code because skills surface the right key files

## What Are Skills?

Skills are short markdown files that give coding agents the repo context they actually need: key files, conventions, patterns, and critical rules. They activate when the agent works in that part of the codebase.

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

## Target Support

Aspens supports multiple agent environments through output targets:

- `claude`: `CLAUDE.md` + `.claude/skills` + Claude hooks
- `codex`: `AGENTS.md` + `.agents/skills` + directory `AGENTS.md`
- `all`: generate both sets together
- we are working on adding more agents and tools - ask or contribute!

## Commands

### `aspens doc init`

Generate agent context from the repo. Scans the codebase, discovers architecture and feature domains, then writes instructions and skills.

  `--recommended` is the fastest path to automatically generate the default settings but you can also do it manually:

```
$ aspens doc init

  ◇ Scanned my-app (fullstack)
    Languages: typescript, javascript
    Frameworks: nextjs, react, tailwind, prisma
    Import graph: 247 files, 892 edges

  ◇ Discovered 8 feature domains:
      auth, courses, billing, profile, ...

  + .claude/skills/base/skill.md
  + .claude/skills/auth/skill.md
  + .claude/skills/billing/skill.md
  ...

  10 created | 4m 32s
```

| Option | Description |
|--------|-------------|
| `--recommended` | Use recommended target, strategy, and generation mode |
| `--dry-run` | Preview without writing files |
| `--force` | Overwrite existing skills |
| `--timeout <seconds>` | Backend timeout (default: 300) |
| `--mode <mode>` | `all`, `chunked`, or `base-only` (skips interactive prompt) |
| `--strategy <strategy>` | `improve`, `rewrite`, or `skip` for existing docs |
| `--domains <list>` | Additional domains to include (comma-separated) |
| `--no-graph` | Skip import graph analysis |
| `--model <model>` | Model for the selected backend |
| `--verbose` | Show backend reads/activity in real time |
| `--target <target>` | Output target: `claude`, `codex`, or `all` |
| `--backend <backend>` | Generation backend: `claude` or `codex` |

### `aspens doc impact`

Check your context's health and coverage, keeping up with the codebase. Checks for:
- Instructions and skills present per target
- Domain coverage vs detected repo domains
- Top hub files surfaced in root guidance
- Whether generated context is older than the newest source changes

### `aspens doc sync`

**This may be the most important command.** Keeps generated context from drifting. Reads recent git changes, maps them to affected skills, and updates only what changed.

```
$ aspens doc sync

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
| `--install-hook` | Install git post-commit auto-sync |
| `--remove-hook` | Remove the git post-commit auto-sync hook |
| `--dry-run` | Preview without writing files |
| `--no-graph` | Skip import graph analysis |
| `--timeout <seconds>` | Backend timeout (default: 300) |
| `--model <model>` | Model for the selected backend |
| `--verbose` | Show backend reads/activity in real time |

### `aspens doc graph`

Rebuild the import graph cache. Runs automatically during `doc init` and `doc sync`, but you can trigger it manually.

```bash
aspens doc graph
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

Inject your project's tech stack, conventions, and file paths into installed Claude agents.

```bash
aspens customize agents
aspens customize agents --dry-run
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without writing files |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--model <model>` | Claude model (e.g., sonnet, opus, haiku) |
| `--verbose` | Show what Claude is doing |

### `aspens save-tokens`

Install token-saving session settings — statusline telemetry, prompt guards, precompact handoffs, and session rotation.

```bash
aspens save-tokens               # Interactive install
aspens save-tokens --recommended # No-prompt install
aspens save-tokens --remove      # Uninstall
```

## How It Works

1. **Scanner** — detects tech stack, frameworks, structure, and domains. Deterministic, no LLM, instant.
2. **Import Graph** — parses imports across JS/TS/Python, resolves aliases, finds hub files and coupling.
3. **Discovery** — 2 parallel LLM passes explore the codebase: one finds feature domains, the other analyzes architecture.
4. **Generation** — writes concise skills guided by the graph + discovery findings. Up to 3 domains in parallel.
5. **Sync** — on each commit, reads the diff, identifies affected skills, and updates only what changed.

## Requirements

- **Node.js 20+**
- At least one supported agent CLI:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
  - Codex CLI

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
