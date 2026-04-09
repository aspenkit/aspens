---
description: List recent handoffs and resume from a selected one
---

Show recent saved handoffs and let the user choose which to resume.

## Steps

1. List all `.aspens/sessions/*-handoff.md` files, sorted newest first (max 10).
2. For each, show: number, timestamp (from filename), and the first `## Task summary` or `## Latest prompt` line if present.
3. If no handoffs exist, say so and stop.
4. Ask the user which handoff to resume (by number).
5. Read the selected handoff file.
6. Summarize the task, current state, and next steps.
7. Continue from where the handoff left off.
