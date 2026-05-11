import { describe, it, expect } from 'vitest';
import { isNoOpDiff, LOCK_FILES } from '../src/lib/diff-classifier.js';

describe('diff-classifier', () => {
  describe('isNoOpDiff', () => {
    it('returns true for empty input', () => {
      expect(isNoOpDiff([])).toBe(true);
    });

    it('returns true for non-array input', () => {
      expect(isNoOpDiff(null)).toBe(true);
      expect(isNoOpDiff(undefined)).toBe(true);
    });

    it('returns true when every changed file is a known lockfile', () => {
      expect(isNoOpDiff(['package-lock.json'])).toBe(true);
      expect(isNoOpDiff(['yarn.lock', 'package-lock.json'])).toBe(true);
      expect(isNoOpDiff(['frontend/package-lock.json'])).toBe(true);
      expect(isNoOpDiff(['poetry.lock', 'Pipfile.lock'])).toBe(true);
    });

    it('returns true when no file has a code-bearing extension', () => {
      expect(isNoOpDiff(['README.md'])).toBe(true);
      expect(isNoOpDiff(['docs/architecture.md', 'CHANGELOG.md'])).toBe(true);
      expect(isNoOpDiff(['package.json'])).toBe(true);
      expect(isNoOpDiff(['.gitignore'])).toBe(true);
    });

    it('returns false when at least one file has a code-bearing extension', () => {
      expect(isNoOpDiff(['src/index.ts'])).toBe(false);
      expect(isNoOpDiff(['package-lock.json', 'src/index.ts'])).toBe(false);
      expect(isNoOpDiff(['README.md', 'src/foo.py'])).toBe(false);
    });

    it('returns false for a single code-bearing file', () => {
      const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift'];
      for (const ext of exts) {
        expect(isNoOpDiff([`src/file${ext}`])).toBe(false);
      }
    });

    it('treats nested-path lockfiles as lockfiles', () => {
      expect(isNoOpDiff(['frontend/package-lock.json', 'backend/poetry.lock'])).toBe(true);
    });

    it('lockfile + non-code-bearing diff is still no-op', () => {
      // No code-bearing file present → no-op via the second predicate.
      expect(isNoOpDiff(['package-lock.json', 'README.md'])).toBe(true);
    });
  });

  describe('LOCK_FILES', () => {
    it('exposes the canonical lockfile set', () => {
      expect(LOCK_FILES.has('package-lock.json')).toBe(true);
      expect(LOCK_FILES.has('yarn.lock')).toBe(true);
      expect(LOCK_FILES.has('pnpm-lock.yaml')).toBe(true);
      expect(LOCK_FILES.has('Cargo.lock')).toBe(true);
      expect(LOCK_FILES.has('Gemfile.lock')).toBe(true);
      expect(LOCK_FILES.has('poetry.lock')).toBe(true);
      expect(LOCK_FILES.has('go.sum')).toBe(true);
      expect(LOCK_FILES.has('composer.lock')).toBe(true);
      expect(LOCK_FILES.has('Pipfile.lock')).toBe(true);
    });

    it('does not include source files', () => {
      expect(LOCK_FILES.has('package.json')).toBe(false);
      expect(LOCK_FILES.has('Cargo.toml')).toBe(false);
    });
  });
});
