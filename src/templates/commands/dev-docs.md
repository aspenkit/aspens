---
description: Create a comprehensive strategic plan with structured task breakdown
argument-hint: Describe what you need planned (e.g., "refactor authentication system", "implement microservices")
---

Create a focused, actionable plan for: $ARGUMENTS

## Instructions

1. **Analyze the request** — determine scope by reading relevant code
2. **Create a plan** with:
   - Goal (one sentence)
   - Approach (brief architectural description, key decisions)
   - Phases with tasks (each phase independently verifiable)
   - Acceptance criteria per phase

3. **Task Breakdown**:
   - Tasks within a phase are independent (can run in parallel)
   - Tasks across phases are sequential
   - Each task specifies files it touches
   - Include acceptance criteria for each task

4. **Create plan file**:
   - Create directory: `dev/active/[task-name]/` (relative to project root)
   - Generate one file: `plan.md`
   - Keep it under 100 lines — concise plans get executed, long ones don't

## Quality Standards
- Plans must be actionable — specific files, specific changes, specific verification commands
- Each phase must leave the codebase in a working state
- Don't plan what you haven't read — examine the code first

## Context References
- Check CLAUDE.md and `.claude/skills/` for project conventions

**Tip**: Use the `plan` agent to both plan AND execute. This command is for when you only need the plan.