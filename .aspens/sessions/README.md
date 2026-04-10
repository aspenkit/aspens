# save-tokens handoffs

Aspens stores saved session handoffs here before Claude compaction or token-limit rotation.

Handoff files are human-readable markdown. They are saved so you can inspect what was preserved before compaction or a fresh-session handoff.

Claude automation is installed by `aspens save-tokens`. Codex does not have an aspens save-tokens runtime integration yet.

This directory is gitignored by default.
