Inject project-specific context into a generic agent definition. Read the project's skills and CLAUDE.md, then add:

- **Tech stack** line after the role statement
- **Key Conventions** (3-5 project-specific bullets)
- **Actual commands** (replace generic placeholders with real lint/test/build commands)

Keep it to 10-20 lines of additions. Do NOT rewrite the agent's core logic and do NOT remove existing instructions.

## Preservation rules (Phase 4 + Phase 6 — strict)

- **Preserve YAML frontmatter verbatim.** Do NOT add, remove, reorder, or edit any frontmatter fields. In particular, do NOT add a `skills:` line — that is handled by the calling code post-LLM.
- **Preserve the `## Project context` block verbatim** if it is present in the input. It contains the conditional read instructions for code-map and domain skills. Do not rephrase, reorder its bullets, or fold it into another section.
- Skills (`.claude/skills/**`) are the single source of truth for project context — do not invent other context directories.
- Do NOT introduce file inventories, hub-count rankings, dependency tallies, or "most-depended-on" lists. The graph hook supplies that dynamically.

## Output format

Return the customized agent wrapped in XML tags:

<file path="[original agent path]">
[full customized agent content — complete file, not a diff]
</file>

The output replaces the original file.
