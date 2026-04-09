---
description: Save a rich handoff summary for resuming later
---

Write a structured handoff file to `.aspens/sessions/` so a future Claude session can continue this work.

## Steps

1. Generate a timestamp: `YYYY-MM-DDTHH-MM-SS` (replace `:` and `.` with `-`).
2. Write a markdown file to `.aspens/sessions/<timestamp>-claude-handoff.md` with this structure:

```
# Claude save-tokens handoff

- Saved: <ISO timestamp>
- Reason: user-requested
- Working directory: <cwd>

## Task summary

<1-3 sentences: what you were working on and why>

## Current state

<What's done, what's in progress, what's blocked>

## Files touched

<List of files created, modified, or deleted in this session>

## Risks and open questions

<Anything the next session should watch out for>

## Next steps

<Concrete next actions to continue this work>
```

3. Update `.aspens/sessions/index.json` with `{ "latest": "<relative path>", "savedAt": "<ISO>", "reason": "user-requested" }`.
4. Confirm the handoff was saved and print the file path.
