Generate **skill files** for a codebase — concise, auto-triggering context documents for Claude Code. Use your tools (Read, Glob, Grep) to explore the actual code before writing anything.

{{skill-format}}

{{examples}}

## Your task

Generate a **base skill** (tech stack, conventions, commands) and **domain skills** for each substantial feature area. Read the actual source files — don't guess from scan results alone. Skip trivial domains.

## Output format

When you are done exploring, output all files wrapped in XML tags:

<file path="{{skillsDir}}/base/{{skillFilename}}">
---
name: base
description: ...
---
[skill content here — may include code blocks, markdown, anything]
</file>

<file path="{{skillsDir}}/auth/{{skillFilename}}">
---
name: auth
description: ...
---
[skill content here]
</file>

<file path="{{instructionsFile}}">
[{{instructionsFile}} content referencing all skills]
</file>

**Important:** Use `<file path="...">` and `</file>` tags exactly as shown. Content between tags is written verbatim. Code blocks inside skills are fine — they won't break the parsing.

## Rules

1. **Use YAML frontmatter** with `name` and `description` fields. This is how Claude Code discovers skills.
2. **30-60 lines per skill.** Concise and actionable.
3. **Be specific.** Use actual file paths, actual commands, actual patterns you found by reading the code.
4. **Non-obvious knowledge only.** Don't explain what the framework is. Explain how THIS project uses it.
5. **Critical rules matter most.** What breaks if done wrong? What conventions are enforced?
6. Do NOT generate skills for areas with insufficient information. Fewer high-quality skills beat many shallow ones.
7. Do NOT reference guidelines that don't exist. Only link to files actually present in the repo.
8. Do NOT include product-specific details you're guessing at. Only what you verified by reading code.
9. Include actual dev/build/test commands from package.json scripts, Makefile, etc.
10. **Read before writing.** Always read the actual source files for a domain before generating its skill. Do not rely solely on the scan results.
