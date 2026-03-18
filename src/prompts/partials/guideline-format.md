## Guideline File Format

A guideline is a longer reference document in `.claude/guidelines/{name}.md`. Guidelines are NOT auto-triggered — they're linked from skills when deeper context is needed.

### Format

```markdown
---
name: [guideline-name]
description: [One-line description]
---

# [Title]

## [Section 1]
[Detailed patterns, code examples, data flows]

## [Section 2]
[More detail]

---
**Last Updated:** [DATE]
```

### When to create a guideline

- When a domain skill needs more than 60 lines of context
- For cross-cutting concerns (error handling, testing patterns, architecture)
- For detailed code examples that don't fit in a skill

### Rules

1. **150-500 lines.** Detailed but focused.
2. **Always linked from a skill.** A guideline without a referencing skill won't be discovered.
3. **Code examples are valuable.** Show actual patterns from the codebase.
4. **Only create when needed.** Most repos need skills, not guidelines.
