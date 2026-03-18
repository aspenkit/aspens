# Changelog

## [0.1.0] - 2026-03-18

### Added
- `aspens scan` — deterministic tech stack, structure, and domain detection
- `aspens doc init` — generate skills and CLAUDE.md via Claude
- `aspens doc sync` — update skills from git diffs
- `aspens doc sync --install-hook` — auto-sync on every commit with 5-minute cooldown
- `aspens add` — install agents, hooks, and slash commands from bundled library
- `aspens customize agents` — inject project context into installed agents
- Chunked generation mode for large repos
- Auto-scaling timeout based on repo size
- `--model` flag for choosing Claude model (sonnet, opus, haiku)
- `--verbose` mode to see Claude's exploration in real time
- Token usage summary after generation
- Repo size estimation in scan output
- Existing docs strategy: improve, rewrite, or skip
- 9 bundled agents, 2 hooks, 2 slash commands
- Test suite (vitest, 69 tests)
