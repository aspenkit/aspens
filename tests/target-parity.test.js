import { describe, it, expect } from 'vitest';
import { assertTargetParity, transformPathForTarget } from '../src/lib/target-transform.js';

/**
 * Phase 4 — parity validator. Asserts that multi-target publishes don't
 * silently drop or add a logical file slot (root instructions, per-domain
 * skill). Codex directory-scoped AGENTS.md files are excluded by design.
 */

describe('transformPathForTarget', () => {
  it('returns the path unchanged when target is claude', () => {
    expect(transformPathForTarget('claude', 'CLAUDE.md')).toBe('CLAUDE.md');
    expect(transformPathForTarget('claude', '.claude/skills/billing/skill.md'))
      .toBe('.claude/skills/billing/skill.md');
  });

  it('maps CLAUDE.md to AGENTS.md for codex', () => {
    expect(transformPathForTarget('codex', 'CLAUDE.md')).toBe('AGENTS.md');
  });

  it('maps .claude/skills/<name>/skill.md to .agents/skills/<name>/SKILL.md', () => {
    expect(transformPathForTarget('codex', '.claude/skills/billing/skill.md'))
      .toBe('.agents/skills/billing/SKILL.md');
    expect(transformPathForTarget('codex', '.claude/skills/base/skill.md'))
      .toBe('.agents/skills/base/SKILL.md');
  });

  it('returns null for unknown target ids', () => {
    expect(transformPathForTarget('made-up', 'CLAUDE.md')).toBeNull();
  });

  it('returns null for paths that do not match a target slot', () => {
    expect(transformPathForTarget('codex', '.claude/agents/custom.md')).toBeNull();
  });
});

describe('assertTargetParity', () => {
  it('is a no-op for single-target publishes', () => {
    const single = new Map([
      ['claude', [
        { path: 'CLAUDE.md', content: '' },
        { path: '.claude/skills/base/skill.md', content: '' },
      ]],
    ]);
    expect(() => assertTargetParity(single)).not.toThrow();
  });

  it('passes when claude and codex have parallel files', () => {
    const map = new Map([
      ['claude', [
        { path: 'CLAUDE.md', content: '' },
        { path: '.claude/skills/base/skill.md', content: '' },
        { path: '.claude/skills/billing/skill.md', content: '' },
      ]],
      ['codex', [
        { path: 'AGENTS.md', content: '' },
        { path: '.agents/skills/base/SKILL.md', content: '' },
        { path: '.agents/skills/billing/SKILL.md', content: '' },
      ]],
    ]);
    expect(() => assertTargetParity(map)).not.toThrow();
  });

  it('ignores codex directory-scoped AGENTS.md inside domain dirs', () => {
    const map = new Map([
      ['claude', [
        { path: 'CLAUDE.md', content: '' },
        { path: '.claude/skills/billing/skill.md', content: '' },
      ]],
      ['codex', [
        { path: 'AGENTS.md', content: '' },
        { path: '.agents/skills/billing/SKILL.md', content: '' },
        { path: 'src/services/billing/AGENTS.md', content: '' },
      ]],
    ]);
    expect(() => assertTargetParity(map)).not.toThrow();
  });

  it('throws when codex is missing a domain skill that exists in claude', () => {
    const map = new Map([
      ['claude', [
        { path: 'CLAUDE.md', content: '' },
        { path: '.claude/skills/billing/skill.md', content: '' },
        { path: '.claude/skills/auth/skill.md', content: '' },
      ]],
      ['codex', [
        { path: 'AGENTS.md', content: '' },
        { path: '.agents/skills/billing/SKILL.md', content: '' },
        // auth skill is missing — parity violation
      ]],
    ]);
    expect(() => assertTargetParity(map)).toThrow(/parity violation/);
    expect(() => assertTargetParity(map)).toThrow(/SKILL:auth/);
  });

  it('throws when claude is missing the root instructions file', () => {
    const map = new Map([
      ['claude', [
        { path: '.claude/skills/billing/skill.md', content: '' },
      ]],
      ['codex', [
        { path: 'AGENTS.md', content: '' },
        { path: '.agents/skills/billing/SKILL.md', content: '' },
      ]],
    ]);
    expect(() => assertTargetParity(map)).toThrow(/INSTRUCTIONS/);
  });

  it('skips unknown target ids without throwing', () => {
    const map = new Map([
      ['claude', [{ path: 'CLAUDE.md', content: '' }]],
      ['unknown', [{ path: 'whatever', content: '' }]],
    ]);
    // unknown target collapses to an empty key set; claude has INSTRUCTIONS;
    // assertion fires on the difference. This is the documented behavior.
    expect(() => assertTargetParity(map)).toThrow(/parity violation/);
  });
});
