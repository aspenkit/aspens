# aspens

Generate and maintain AI-ready documentation for any codebase. Aspens scans your repo, uses Claude to produce structured skill files, and keeps them updated on every commit.

Skills are concise markdown files (~35 lines) that Claude Code loads automatically when you work in specific parts of your codebase. They give Claude the context it needs to write correct code — key files, patterns, conventions, critical rules.

![aspens demo](demo/demo-full.gif)

## Quick Start

```bash
npx aspens scan .                    # See what's in your repo
npx aspens doc init .                # Generate skills + CLAUDE.md
npx aspens doc sync --install-hook   # Auto-update on every commit
```

Requires [Node.js 18+](https://nodejs.org) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Commands

### `aspens scan [path]`

Detect tech stack, frameworks, structure, and domains. No LLM calls — pure file system inspection.

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

  Detected domains
    auth (src/services/auth, src/components/auth)
    billing (src/services/billing)

  Claude Code
    .claude/ no  CLAUDE.md no
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### `aspens doc init [path]`

Generate skills and CLAUDE.md by scanning your repo and having Claude explore the code.

Claude gets read-only access to your repo (Read, Glob, Grep) and explores it to understand patterns, conventions, and critical rules. It then generates skill files that Claude Code discovers automatically.

```
$ aspens doc init .

  ◆ aspens doc init

  ◇ Scanned my-app (fullstack)

    Languages: typescript, javascript
    Frameworks: nextjs, react, tailwind, prisma
    Domains: auth, billing, notifications

  ◆ 3 domains detected. Generate skills:
  ● All at once
  ○ One domain at a time
  ○ Pick specific domains
  ○ Base skill only

  ◇ Exploring repo and generating skills...
  ◇ Generated 5 files

  + .claude/skills/base/skill.md
  + .claude/skills/auth/skill.md
  + .claude/skills/billing/skill.md
  + .claude/skills/notifications/skill.md
  + CLAUDE.md

  5 created
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without writing files |
| `--force` | Overwrite existing skills |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--mode <mode>` | `all`, `chunked`, or `base-only` (skips interactive prompt) |
| `--strategy <strategy>` | `improve`, `rewrite`, or `skip` for existing docs (skips interactive prompt) |
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
| `--install-hook` | Install git post-commit hook for auto-sync |
| `--dry-run` | Preview without writing files |
| `--timeout <seconds>` | Claude timeout (default: 300) |
| `--model <model>` | Claude model (e.g., sonnet, opus, haiku) |
| `--verbose` | Show what Claude is reading in real time |

### `aspens add <type> [name]`

Add individual components from the bundled library.

```bash
aspens add agent all              # Add all 9 AI agents
aspens add agent code-reviewer    # Add a specific agent
aspens add agent --list           # Browse available agents
aspens add hook skill-activation  # Add auto-triggering hooks
aspens add command dev-docs       # Add slash commands
```

| Option | Description |
|--------|-------------|
| `--list` | Browse available components |
| `--force` | Overwrite existing files |

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
Your Repo ──▶ Scanner ──▶ Claude ──▶ .claude/skills/
               (detect     (explore    (skill files
               stack,       code,       Claude Code
               domains)     generate)   loads auto)
```

1. **Scanner** detects your tech stack, frameworks, structure, and domains. Deterministic — no LLM, instant, free.
2. **Claude** explores your codebase with read-only tools (Read, Glob, Grep). It reads actual source files, follows patterns, and generates skills based on what it finds.
3. **Skills** are written to `.claude/skills/` in your repo. Claude Code discovers them automatically via YAML frontmatter.

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

## Requirements

- **Node.js 18+**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
