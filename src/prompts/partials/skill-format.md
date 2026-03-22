## Skill File Format

A skill is a markdown file in `.claude/skills/{domain}/skill.md` with YAML frontmatter.

### Base skill (one per repo)

```markdown
---
name: base
description: Core conventions, tech stack, and project structure for [repo-name]
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

You are working in **[repo-name]**.

## Tech Stack
[Framework] | [Language] | [Key libraries]

## Commands
- `[dev command]` — Start dev server
- `[test command]` — Run tests
- `[lint/check command]` — Lint + typecheck

## Critical Conventions
- [Non-obvious convention 1]
- [Non-obvious convention 2]

## Structure
- `[dir]/` — [what's in it]
- `[dir]/` — [what's in it]

---
**Last Updated:** [DATE]
```

### Domain skill (one per feature area)

```markdown
---
name: [domain-name]
description: [One-line description of what this domain covers]
---

## Activation

This skill triggers when editing [domain]-related files:
- `[file pattern 1]`
- `[file pattern 2]`

---

You are working on **[domain description]**.

## Key Files
- `[file]` — [what it does]
- `[file]` — [what it does]

## Key Concepts
- **[Concept]:** [Brief explanation of how it works]
- **[Pattern]:** [How things are done in this domain]

## Critical Rules
- [Rule that would break things if violated]
- [Non-obvious gotcha]

## References
- **Patterns:** `.claude/guidelines/[domain]/patterns.md`
- **Error Handling:** `.claude/guidelines/error-handling.md`

---
**Last Updated:** [DATE]
```

### Rules

1. **30-60 lines max.** Only what an AI needs to write correct code.
2. **Be specific.** Real file paths, real commands, real patterns.
3. **Non-obvious knowledge only.** Don't explain the framework. Explain THIS project's usage of it.
4. **Critical rules matter most.** What breaks if done wrong?
5. **YAML frontmatter is required.** `name` and `description` fields enable Claude Code discovery.

### Activation section requirements

The `## Activation` section MUST be machine-parseable for automatic skill activation. Follow this exact format:

```markdown
## Activation

This skill triggers when editing these files:
- `path/to/file.js`
- `src/dir/**/*.ts`

Keywords: keyword1, keyword2, keyword3
```

- File patterns MUST be on their own line, prefixed with `- `, wrapped in backticks.
- The `Keywords:` line MUST be in the Activation section, comma-separated. These are case-insensitive terms that trigger this skill when they appear in a user prompt.
- For the base skill, use `This is a **base skill** that always loads when working in this repository.` (no file patterns or keywords needed).

### References section

Every domain skill MUST include a `## References` section pointing to deeper guideline docs that Claude can read on demand:

```markdown
## References
- **Patterns:** `.claude/guidelines/{domain}/patterns.md`
- **Error Handling:** `.claude/guidelines/error-handling.md`
```

- Each reference is a bullet with a bold label and a backtick-wrapped path to a guideline file.
- This keeps skills lean (35-60 lines) while giving Claude access to deep implementation details (200-500 lines) via the Read tool.
