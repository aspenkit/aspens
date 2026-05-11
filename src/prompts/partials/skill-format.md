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

## Domain purpose
[One paragraph: what this domain DOES for the business and what users/systems rely on it.]

## Business rules / invariants
- [Concrete rule that must always hold — e.g. "Stripe subscriptions cancel at period end, never immediately"]
- [Authorization/data invariant — e.g. "Only the request owner or staff can mutate this resource"]

## Non-obvious behaviors
- [Behavior the code wouldn't reveal at a glance — e.g. "Auth callback redirects to onboarding if profile is incomplete"]
- [Edge case the implementation handles silently]

## Critical files (purpose, not inventory)
- `[file]` — [what role it plays in the domain — not "exports X, Y, Z"]

## Critical Rules
- [Rule that would break things if violated]

---
**Last Updated:** [DATE]
```

### Rules

- 30-60 lines max. Only what an AI needs to write correct code.
- Be specific: real file paths, real commands, real patterns.
- Non-obvious knowledge only — don't explain the framework, explain THIS project's usage.
- Activation: file patterns as `- \`glob\`` lines; `Keywords:` comma-separated. Base skill uses "always loads" sentence instead.
- **Lead with business behavior, not file inventory.** Forbidden in skills: file counts, hub names, dependency tallies, line counts, "most depended on" rankings — the graph supplies these dynamically. Skills are about WHAT the code does for the business and WHY, not metadata about the code.
