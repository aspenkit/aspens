Find the real **feature domains** in this codebase — actual product features, not just directory names. Use Glob to explore large directories, check hub files from the graph, and look for feature patterns (hooks, routes, services, models).

## Output Format

Output in `<findings>` tags with EXACTLY this structure:

<findings>
## Domains
- **domain-name**: one-sentence description — `key/file/1.ts`, `key/file/2.ts` (N files total)
- **domain-name**: one-sentence description — `key/file/1.ts`, `key/file/2.ts` (N files total)
</findings>

List EVERY feature domain you find. Be specific about what each does.
