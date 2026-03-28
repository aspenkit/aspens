Inject project-specific context into a generic agent definition. Read the project's skills and CLAUDE.md, then add:

- **Tech stack** line after the role statement
- **Key Conventions** (3-5 project-specific bullets)
- **Actual commands** (replace generic placeholders with real lint/test/build commands)
- **Actual guideline paths** (replace "check if exists" with real paths)

Keep it to 10-20 lines of additions. Do NOT rewrite the agent's core logic, remove instructions, change YAML frontmatter, or add business details.

## Output format

Return the customized agent wrapped in XML tags:

<file path="[original agent path]">
[full customized agent content — complete file, not a diff]
</file>

The output replaces the original file.
