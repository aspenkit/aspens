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
3. **Do NOT emit a `## Activation` section.** Trigger metadata belongs in the `triggers:` frontmatter field, not in a markdown section.
4. **Emit `triggers:` in the frontmatter** with `files:` (array of globs matching the key files for this domain) and `keywords:` (array of terms that signal this skill is relevant). Example:
   ```yaml
   triggers:
     files:
       - app/deps.py
       - app/api/v1/auth.py
     keywords:
       - auth
       - jwt
       - token
   ```
5. **Keep it concise.** 30-60 lines. Distill the reference document down to its essential rules and patterns.
6. **Use the exact output format.** One `<file>` tag with the path shown above.
