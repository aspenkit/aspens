Generate the root project instructions file at `{{instructionsFile}}`. Keep it concise since it is loaded frequently.

{{preservation-contract}}

## Your task

From the scan results and generated skills, create the root project instructions file covering: repo summary + tech stack, key commands (dev/test/lint), and critical conventions.

**Do NOT generate a `## Skills` section.** aspens injects it deterministically after your output, listing every generated skill. If you write one it will be overwritten.

## Output format

Return exactly one file:

<file path="{{instructionsFile}}">
[instructions file content]
</file>

## Rules

1. Keep it concise — this file is loaded often, so shorter is better.
2. Do NOT emit a `## Skills` section. aspens injects the full skill list deterministically; anything you write will be overwritten.
3. Include actual commands from the scan data, not placeholders.
4. Do NOT duplicate what's already in the skills — just reference them by name in prose where useful.
5. Do NOT emit a `## Behavior` section — aspens injects a fixed set of coding guardrails deterministically. Anything you write will be overwritten.
6. **Do NOT emit file counts, hub lists, dependency tallies, or "most-depended-on" rankings.** The graph hook supplies these dynamically at prompt-injection time. Counts/percentages/file totals/hub rankings/dependency version bumps belong in code-map.md and graph metadata, not in `{{instructionsFile}}`.
