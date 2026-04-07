---
name: architecture
description: >
  Use when modifying imports, creating new files, refactoring modules,
  or understanding how components relate. Not needed for simple single-file edits.
---

# Architecture

This skill provides codebase structure and import graph data.

When you need to understand file relationships, hub files, or domain clusters,
check `references/code-map.md` for the full import graph analysis.

## Key Rules

- Check hub files (high fan-in) before modifying - changes propagate widely
- Respect domain cluster boundaries - keep related files together
- Check cross-domain dependencies before creating new imports

