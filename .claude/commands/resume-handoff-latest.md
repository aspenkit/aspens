---
description: Resume from the most recent saved handoff
---

Load the latest saved handoff from `.aspens/sessions/` and continue the work from that context.

## Steps

1. Read `.aspens/sessions/index.json`. If it has a `latest` field, verify the referenced file exists before reading it. If the file is missing, fall back to step 2.
2. If `index.json` is missing, stale, or points to a deleted file, list `.aspens/sessions/*-handoff.md`, pick the newest by filename.
3. If no handoff exists, say so and stop.
4. Read the handoff file.
5. Summarize the task, current state, and next steps from the handoff.
6. Continue from where the handoff left off. Do not repeat completed work unless verification is needed.
