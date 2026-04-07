## Skill File Format

Skill = markdown file at `{{skillsDir}}/{domain}/{{skillFilename}}` with YAML frontmatter (`name`, `description` required).

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
- `[command]` — [purpose]

## Critical Conventions
- [Non-obvious convention — what breaks if violated]

## Structure
- `[dir]/` — [what's in it]

---
**Last Updated:** [DATE]
```

### Domain skill (one per feature area)

```markdown
---
name: [domain-name]
description: [One-line description]
---

## Activation

This skill triggers when editing these files:
- `[file pattern]`

Keywords: keyword1, keyword2

---

You are working on **[domain description]**.

## Key Files
- `[file]` — [what it does]

## Key Concepts
- **[Concept]:** [Brief explanation]

## Critical Rules
- [Rule that would break things if violated]

## References
- **Patterns:** `{{configDir}}/guidelines/{domain}/patterns.md`

---
**Last Updated:** [DATE]
```

### Rules

- 30-60 lines max. Only what an AI needs to write correct code.
- Be specific: real file paths, real commands, real patterns.
- Non-obvious knowledge only — don't explain the framework, explain THIS project's usage.
- Activation: file patterns as `- \`glob\`` lines; `Keywords:` comma-separated. Base skill uses "always loads" sentence instead.
- References section required on domain skills — bold label + backtick path to guideline files.
