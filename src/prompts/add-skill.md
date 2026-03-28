Create a **skill file** from a reference document. You have Read/Glob/Grep tools for codebase context.

{{skill-format}}

## Your task

Read the reference document, then explore the codebase for related files and patterns. Synthesize a skill capturing the essential knowledge an AI assistant needs.

## Output format

Return exactly one file:

<file path="{{skillPath}}">
[full skill content]
</file>

## Rules

1. **Extract actionable knowledge.** Focus on what an AI needs to write correct code or follow correct processes — not background reading.
2. **Be specific.** Use actual file paths, commands, and patterns from the reference doc and codebase.
3. **Write activation patterns.** Include file patterns and keywords that should trigger this skill.
4. **Keep it concise.** 30-60 lines. Distill the reference document down to its essential rules and patterns.
5. **Use the exact output format.** One `<file>` tag with the path shown above.
