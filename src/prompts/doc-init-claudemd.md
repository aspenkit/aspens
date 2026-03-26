You are generating a CLAUDE.md file for a software project. CLAUDE.md is the entry point that Claude Code reads when starting a session.

## Your task

Given the repository scan results and the list of skills that were generated, create a CLAUDE.md that:
1. Summarizes what this repo is and its tech stack
2. Lists all available skills with their activation triggers
3. Includes key commands (dev, test, lint)
4. Notes any critical conventions

## Output format

Return exactly one file:

<file path="CLAUDE.md">
[CLAUDE.md content]
</file>

## Rules

1. Keep it concise — CLAUDE.md is loaded on every prompt, so shorter is better.
2. Reference skills by their path (e.g., `.claude/skills/billing/skill.md`).
3. Include actual commands from the scan data, not placeholders.
4. Do NOT duplicate what's already in the skills — just reference them.
5. Always include a `## Behavior` section with these rules verbatim:
   - **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
   - **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.
