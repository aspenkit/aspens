# Target Support

This document defines how aspens supports Claude and Codex today, and how to add Codex to a repo that already uses Claude.

## Target Model

Aspens separates two concepts:

- `target`: where generated docs are written and how the AI tool discovers them
- `backend`: which CLI generates the content

Examples:

- `--target claude --backend claude`
- `--target codex --backend codex`
- `--target all --backend claude`

The target controls the published artifacts. The backend controls which LLM CLI is used to generate them.

## Claude Support

Claude support is hook-aware and file-aware.

Published artifacts:

- `CLAUDE.md`
- `.claude/skills/<name>/skill.md`
- `.claude/hooks/...`
- `.claude/settings.json`

Operational model:

- Claude reads `CLAUDE.md`
- Claude can auto-activate skills through hooks and activation rules
- `aspens doc sync --install-hook` installs a Claude post-commit hook for automatic updates

## Codex Support

Codex support is document-driven rather than hook-driven.

Published artifacts:

- root `AGENTS.md`
- `.agents/skills/<name>/SKILL.md`
- directory-scoped `AGENTS.md` files for local context when needed

Operational model:

- Codex reads the root `AGENTS.md` as the repo-wide instruction file
- Codex can use directory `AGENTS.md` files for local instructions
- Codex can use reusable `.agents/skills/.../SKILL.md` documents for deeper topic guidance
- Codex does not use the Claude hook system

Current limitation:

- Claude hooks are first-class in aspens today
- Codex does not have a matching hook layer in aspens
- Codex support is based on writing the right instruction files in the right places

## CLAUDE.md vs AGENTS.md

These files play the same top-level role for different targets:

- Claude repo-wide instructions: `CLAUDE.md`
- Codex repo-wide instructions: `AGENTS.md`

If you want repo-level rules, conventions, commands, or architecture notes for Codex, they belong in root `AGENTS.md`.

## Adding Codex To A Repo That Already Uses Claude

You do not need to treat Codex setup as a completely separate project.

Aspens already uses a canonical generation model internally:

1. generate canonical repo instructions and skills
2. project them into target-specific output

That means an existing Claude setup can be a strong starting point for Codex.

Recommended flow:

```bash
aspens doc init --target codex
```

Or, if you want both targets refreshed together:

```bash
aspens doc init --target all
```

What this should do conceptually:

- reuse existing repo understanding where possible
- improve existing docs when they already exist
- publish Codex-native artifacts without forcing you to rebuild your repo docs from scratch

In practice, this means aspens should use the existing `CLAUDE.md` and `.claude/skills` as useful source context when generating or improving Codex output, instead of pretending the repo has no AI docs yet.

## Command Behavior By Target

### `aspens doc init`

Claude target:

- generates `CLAUDE.md`
- generates `.claude/skills/.../skill.md`
- can install/update Claude hooks and settings

Codex target:

- generates `AGENTS.md`
- generates `.agents/skills/.../SKILL.md`
- generates directory `AGENTS.md` files when needed
- does not install Claude hooks

All targets:

- updates both Claude and Codex artifacts from one run

### `aspens doc sync`

Claude target:

- updates Claude docs from recent commits
- can install/remove the Claude post-commit hook

Codex target:

- updates Codex docs from recent commits
- should refresh derived Codex directory docs from the current skill set

### `aspens add skill`

Claude target:

- scaffolds `.claude/skills/<name>/skill.md`

Codex target:

- scaffolds `.agents/skills/<name>/SKILL.md`

## Product Guidance

Keep the user-facing language aligned with the active target.

Good Claude-facing language:

- `CLAUDE.md`
- Claude hooks
- Claude skills

Good Codex-facing language:

- `AGENTS.md`
- `.agents/skills`
- directory `AGENTS.md`

Avoid leaking canonical internal terms like `base skill` or `Generate CLAUDE.md` in Codex mode.
