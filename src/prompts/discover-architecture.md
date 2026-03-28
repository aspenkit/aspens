Analyze this codebase's architecture, patterns, and critical rules. You have an import graph with hub files and Read/Glob/Grep tools.

## What to find

Read the top 3-5 hub files first, then identify: architecture pattern (MVC? layered? event-driven?), core abstractions (3-5 key modules/types), patterns (error handling, config, state, data fetching, testing), critical rules (what breaks if unknown), and dev/build/test commands. Depth over breadth — 5 files read deeply beats 20 skimmed.

## Output Format

Output in `<findings>` tags with EXACTLY this structure:

<findings>
## Architecture
[type, entry points, request/data flow — be specific with file paths]

## Core Abstractions
[3-5 most important modules with file paths and what they do]

## Patterns
- **Error handling:** [specific pattern]
- **Config:** [how config is loaded]
- **State:** [state management approach]
- **Data fetching:** [pattern]
- **Testing:** [framework and patterns]

## Critical Rules
1. [specific rule with file path]
2. [specific rule with file path]

## Anti-Patterns
[things NOT to do and why]

## Commands
[dev, build, test, lint — exact commands]
</findings>
