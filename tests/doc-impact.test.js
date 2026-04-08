import { describe, it, expect } from 'vitest';
import { buildApplyPlan, buildApplyConfirmationMessage } from '../src/commands/doc-impact.js';

describe('buildApplyPlan', () => {
  it('preserves target context for target-specific init actions', () => {
    const plan = buildApplyPlan([
      {
        id: 'claude',
        actions: [
          'aspens doc init --hooks-only',
          'aspens doc init --mode base-only --strategy rewrite',
        ],
      },
      {
        id: 'codex',
        actions: [],
      },
    ]);

    expect(plan).toEqual([
      {
        action: 'aspens doc init --hooks-only',
        target: { id: 'claude', actions: ['aspens doc init --hooks-only', 'aspens doc init --mode base-only --strategy rewrite'] },
      },
      {
        action: 'aspens doc init --mode base-only --strategy rewrite',
        target: { id: 'claude', actions: ['aspens doc init --hooks-only', 'aspens doc init --mode base-only --strategy rewrite'] },
      },
    ]);
  });

  it('deduplicates repo-wide sync actions across targets', () => {
    const plan = buildApplyPlan([
      { id: 'claude', actions: ['aspens doc sync'] },
      { id: 'codex', actions: ['aspens doc sync'] },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('aspens doc sync');
  });
});

describe('buildApplyConfirmationMessage', () => {
  it('uses the explicit apply confirmation prompt', () => {
    expect(buildApplyConfirmationMessage()).toBe('Do you want to apply recommendations?');
  });
});
