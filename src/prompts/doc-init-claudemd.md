Generate the root project instructions file at `{{instructionsFile}}`. Keep it concise since it is loaded frequently.

## Your task

From the scan results and generated skills, create the root project instructions file covering: repo summary + tech stack, available skills, key commands (dev/test/lint), critical conventions, and when graph data is provided, a short `## Key Files` section surfacing the top hub files.

## Output format

Return exactly one file:

<file path="{{instructionsFile}}">
[instructions file content]
</file>

## Rules

1. Keep it concise — this file is loaded often, so shorter is better.
2. Reference skills by their path (e.g., `{{skillsDir}}/billing/{{skillFilename}}`).
3. Include actual commands from the scan data, not placeholders.
4. Do NOT duplicate what's already in the skills — just reference them.
5. Always include a `## Behavior` section with these rules verbatim:
   - **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
   - **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.
6. If hub files are provided in the prompt, include a concise `## Key Files` section that mentions them explicitly by path.
