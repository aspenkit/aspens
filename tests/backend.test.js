import { describe, it, expect } from 'vitest';
import { resolveBackend, BACKENDS } from '../src/lib/backend.js';

describe('resolveBackend', () => {
  describe('explicit backendFlag', () => {
    it('returns claude when backendFlag="claude" and available', () => {
      const { backend, warning } = resolveBackend({
        backendFlag: 'claude',
        available: { claude: true, codex: false },
      });
      expect(backend.id).toBe('claude');
      expect(warning).toBeNull();
    });

    it('throws when backendFlag="codex" and codex not available', () => {
      expect(() =>
        resolveBackend({
          backendFlag: 'codex',
          available: { claude: true, codex: false },
        })
      ).toThrow('Codex CLI is not installed');
    });

    it('throws for unknown backend flag', () => {
      expect(() =>
        resolveBackend({
          backendFlag: 'gpt',
          available: { claude: true, codex: true },
        })
      ).toThrow('Unknown backend: "gpt"');
    });
  });

  describe('target-based matching', () => {
    it('returns claude when targetId="claude" and available', () => {
      const { backend, warning } = resolveBackend({
        targetId: 'claude',
        available: { claude: true, codex: false },
      });
      expect(backend.id).toBe('claude');
      expect(warning).toBeNull();
    });

    it('falls back to claude with warning when targetId="codex" but codex unavailable', () => {
      const { backend, warning } = resolveBackend({
        targetId: 'codex',
        available: { claude: true, codex: false },
      });
      expect(backend.id).toBe('claude');
      expect(warning).toContain('Codex CLI not found');
      expect(warning).toContain('Using Claude CLI');
    });

    it('falls back to codex with warning when targetId="claude" but claude unavailable', () => {
      const { backend, warning } = resolveBackend({
        targetId: 'claude',
        available: { claude: false, codex: true },
      });
      expect(backend.id).toBe('codex');
      expect(warning).toContain('Claude CLI not found');
      expect(warning).toContain('Using Codex CLI');
    });
  });

  describe('no target preference', () => {
    it('returns claude when available and no targetId', () => {
      const { backend, warning } = resolveBackend({
        available: { claude: true, codex: true },
      });
      expect(backend.id).toBe('claude');
      expect(warning).toBeNull();
    });

    it('returns codex when only codex available', () => {
      const { backend, warning } = resolveBackend({
        available: { claude: false, codex: true },
      });
      expect(backend.id).toBe('codex');
      expect(warning).toBeNull();
    });
  });

  describe('nothing available', () => {
    it('throws with install message when neither backend available', () => {
      expect(() =>
        resolveBackend({
          available: { claude: false, codex: false },
        })
      ).toThrow('aspens requires either Claude CLI or Codex CLI');
    });

    it('throws with install URLs', () => {
      expect(() =>
        resolveBackend({ available: { claude: false, codex: false } })
      ).toThrowError(new RegExp(`${BACKENDS.claude.installUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${BACKENDS.codex.installUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

      try {
        resolveBackend({ available: { claude: false, codex: false } });
      } catch (err) {
        expect(err.message).toContain(BACKENDS.claude.installUrl);
        expect(err.message).toContain(BACKENDS.codex.installUrl);
      }
    });
  });
});
