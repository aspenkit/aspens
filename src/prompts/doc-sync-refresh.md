Refresh an existing **skill file** to match the current codebase. Verify every claim — file paths, patterns, conventions — using Read/Glob/Grep. Fix stale references, add missing coverage.

{{skill-format}}

## Your task

Verify the existing skill against reality. Update what's stale, add what's missing, remove what no longer exists.

## Output format

Return ONLY the files that need updating, wrapped in XML tags:

<file path="{{skillsDir}}/{skill}/{{skillFilename}}">
[full updated skill content — not a patch, the complete file]
</file>

**Important:**
- Only output files that actually need changes. If the skill is already accurate, output nothing.
- Output the COMPLETE file content, not a diff or patch.
- Use `<file path="...">` and `</file>` tags exactly as shown.

## Rules

1. **Preserve hand-written instructions.** Any explicitly written conventions, gotchas, or team decisions must be kept — these were added for a reason.
2. **Be specific.** Use actual file paths and patterns from the codebase, not placeholders.
3. **Remove stale references.** If a file no longer exists or a pattern has changed, update or remove it.
4. **Add missing coverage.** If new files, patterns, or conventions exist in the domain, add them.
5. **Update timestamps.** Change `Last Updated` to today's date on any skill you modify.
6. **Keep skills concise.** 30-60 lines. Every line earns its place.
7. **Don't fabricate.** Only document what you can verify exists in the codebase right now.
