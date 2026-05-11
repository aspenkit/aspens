Generate ONE skill file for the **{{domainName}}** domain. Use Read/Glob/Grep to explore the actual source files before writing.

{{preservation-contract}}

{{skill-format}}

## Your task

Read the base skill below for repo conventions, then explore {{domainName}} files from the scan results. Read source code for patterns, abstractions, and critical rules. Generate a focused skill based on what you verified.

## Output format

Return exactly one file wrapped in XML tags:

<file path="{{skillsDir}}/{{domainName}}/{{skillFilename}}">
[skill content with YAML frontmatter]
</file>

## Rules

1. **Use YAML frontmatter** with `name` and `description` fields.
2. **30-60 lines.** Concise and actionable.
3. **Be specific.** Use actual file paths, actual patterns from the code you read.
4. **Non-obvious knowledge only.** The base skill already covers the tech stack and general conventions. Focus on what's unique to THIS domain.
5. **Critical rules matter most.** What breaks if done wrong?
6. Do NOT include product-specific details you're guessing at. Only what you verified by reading code.
7. If there isn't enough substance for a meaningful skill, return an empty response instead of generating filler.
8. **Lead with what this domain DOES for the business** and what rules apply that aren't obvious from the code. Examples:
   - "Stripe subscriptions cancel at period end, never immediately."
   - "Auth callback must redirect to onboarding if profile is incomplete."
   - "Course enrollment is idempotent — repeat POSTs return the same enrollment, no duplicate side effects."
   - "Refund window is 14 days from charge date, then locked."
9. **Forbidden:** file inventories, import lists, line counts, hub names, dependency tallies, "most depended-on" rankings — the graph supplies these dynamically. Skills are about WHAT the code does for the business and WHY, not metadata about the code.
