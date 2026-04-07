Update existing **skill files** based on a git diff. If the diff is truncated, use Read to get full file contents.

{{skill-format}}

## Your task

Update only affected skills. Create new domain skills if the diff introduces a new feature area. Update CLAUDE.md if repo-level structure, commands, or conventions changed.

## Output format

Return ONLY the files that need updating, wrapped in XML tags:

<file path="{{skillsDir}}/{skill}/{{skillFilename}}">
[full updated skill content — not a patch, the complete file]
</file>

<file path="{{instructionsFile}}">
[full updated CLAUDE.md — only if it needs changes]
</file>

**Important:**
- Only output files that actually changed. If a skill doesn't need updates, don't include it.
- Output the COMPLETE file content, not a diff or patch. The file will be written as-is.
- Use `<file path="...">` and `</file>` tags exactly as shown.
- If nothing needs updating (cosmetic changes, test-only changes, docs-only changes), output nothing.

## Rules

1. **Preserve existing content.** Don't rewrite skills from scratch. Update what changed, keep what's still accurate.
2. **Preserve hand-written instructions.** Any explicitly written conventions, gotchas, or team decisions in existing skills or CLAUDE.md must be kept.
3. **Be minimal.** Only update what the diff affects. A change to billing code should not trigger updates to the auth skill.
4. **Update timestamps.** Change `Last Updated` to today's date on any skill you modify.
5. **Be specific.** Reference actual file paths and patterns from the diff and codebase.
6. **Skip trivial changes.** Typo fixes, comment changes, import reordering — these don't warrant skill updates.
7. If a diff adds a completely new feature area with significant code, create a new domain skill for it.
