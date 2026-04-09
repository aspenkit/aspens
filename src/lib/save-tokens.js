export const DEFAULT_SAVE_TOKENS_CONFIG = Object.freeze({
  enabled: true,
  warnAtTokens: 175000,
  compactAtTokens: 200000,
  saveHandoff: true,
  sessionRotation: true,
  claude: {
    enabled: true,
    mode: 'automatic',
  },
});

export function buildSaveTokensConfig(existing = {}) {
  return {
    ...DEFAULT_SAVE_TOKENS_CONFIG,
    ...existing,
    claude: {
      ...DEFAULT_SAVE_TOKENS_CONFIG.claude,
      ...(existing?.claude || {}),
    },
  };
}

export function buildSaveTokensSettings() {
  return {
    statusLine: {
      type: 'command',
      command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-statusline.sh"',
    },
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-prompt-guard.sh"',
            },
          ],
        },
      ],
      PreCompact: [
        {
          hooks: [
            {
              type: 'command',
              command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-precompact.sh"',
            },
          ],
        },
      ],
    },
  };
}

export function buildSaveTokensGitignore() {
  return '*\n!.gitignore\n!README.md\n';
}

export function buildSaveTokensReadme() {
  return [
    '# save-tokens handoffs',
    '',
    'Aspens stores saved session handoffs here before Claude compaction or token-limit rotation.',
    '',
    'Handoff files are human-readable markdown. They are saved so you can inspect what was preserved before compaction or a fresh-session handoff.',
    '',
    'Claude automation is installed by `aspens save-tokens`. Codex does not have an aspens save-tokens runtime integration yet.',
    '',
    'This directory is gitignored by default.',
    '',
  ].join('\n');
}

export function buildSaveTokensRecommendations(config = DEFAULT_SAVE_TOKENS_CONFIG) {
  return [
    `Claude warnings at ${formatCompactLabel(config.warnAtTokens)} and ${formatCompactLabel(config.compactAtTokens)} tokens`,
    'Automatic handoff saves before compacting and at the 200k warning',
  ];
}

function formatCompactLabel(value) {
  return value >= 1000 && value % 1000 === 0
    ? `${value / 1000}k`
    : String(value);
}
