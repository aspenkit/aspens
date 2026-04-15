Generate the root project instructions file at `{{instructionsFile}}`. Keep it concise since it is loaded on every prompt.

## Your task

From the scan results and generated skills, create the root project instructions file covering: one-line repo summary + tech stack, available skills, key commands (dev/test/lint), and critical conventions.

A Project Atlas section with hub files, domains, and hotspots will be appended automatically after generation — do NOT include a Key Files or Project Layout section.

## Output format

Return exactly one file:

<file path="{{instructionsFile}}">
[instructions file content]
</file>

## Rules

1. **Brevity is critical** — this file is loaded on every prompt and consumes cached tokens. Every line must earn its place.
2. Reference skills by their path (e.g., `{{skillsDir}}/billing/{{skillFilename}}`).
3. Include actual commands from the scan data, not placeholders.
4. Do NOT duplicate what's already in the skills — just reference them.
5. Do NOT add a Key Files, Project Layout, or Project Structure section — the auto-appended Project Atlas already covers hub files and domains.
6. Always include a `## Behavior` section with these rules verbatim:
   - **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven't verified it in this session, say so rather than assuming.
   - **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.
