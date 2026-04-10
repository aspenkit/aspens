---
description: Save a rich handoff summary for resuming later
---

Write a structured handoff file to `.aspens/sessions/` so a future Claude session can continue this work.

## Steps

1. Generate a timestamp: `YYYY-MM-DDTHH-MM-SS` (replace `:` and `.` with `-`).
2. Write a markdown file to `.aspens/sessions/<timestamp>-claude-handoff.md` with this structure:

```md
# Claude save-tokens handoff

- Saved: <ISO timestamp>
- Reason: user-requested
- Session tokens: <estimate if known, else "unknown">
- Working directory: <cwd>
- Branch: <current git branch>

## Task summary

<1-3 sentences: what you were working on and why>

## Files modified

<List files you created, modified, or deleted — one per line, bulleted>

## Git commits

<List commits made this session, or "(none)">

## Current state

<What's done, what's in progress, what's blocked>

## Next steps

<Concrete next actions to continue this work>
```

3. Update `.aspens/sessions/index.json` with `{ "latest": "<relative path>", "savedAt": "<ISO>", "reason": "user-requested" }`.
4. Confirm the handoff was saved and print the file path.
