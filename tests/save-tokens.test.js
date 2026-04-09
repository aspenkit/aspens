import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SAVE_TOKENS_CONFIG,
  buildSaveTokensConfig,
  buildSaveTokensRecommendations,
  buildSaveTokensSettings,
} from '../src/lib/save-tokens.js';

describe('buildSaveTokensConfig', () => {
  it('returns the recommended defaults', () => {
    const config = buildSaveTokensConfig();
    expect(config).toEqual(DEFAULT_SAVE_TOKENS_CONFIG);
  });

  it('merges nested backend config without dropping defaults', () => {
    const config = buildSaveTokensConfig({
      warnAtTokens: 160000,
      claude: { mode: 'manual', enabled: false },
    });

    expect(config.warnAtTokens).toBe(160000);
    expect(config.compactAtTokens).toBe(200000);
    expect(config.claude.enabled).toBe(false);
    expect(config.claude.mode).toBe('manual');
  });
});

describe('buildSaveTokensSettings', () => {
  it('installs UserPromptSubmit and PreCompact hooks for Claude', () => {
    const settings = buildSaveTokensSettings();
    expect(settings.statusLine.command).toContain('save-tokens-statusline.sh');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('save-tokens-prompt-guard.sh');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toContain('save-tokens-precompact.sh');
  });
});

describe('buildSaveTokensRecommendations', () => {
  it('formats the recommended items for the installer prompt', () => {
    expect(buildSaveTokensRecommendations()).toEqual([
      'Claude warnings at 175k and 200k tokens',
      'Automatic handoff saves before compacting and at the 200k warning',
    ]);
  });
});
