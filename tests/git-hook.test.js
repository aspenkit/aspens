import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { installGitHook, removeGitHook } from '../src/lib/git-hook.js';

const TEST_DIR = join(import.meta.dirname, 'tmp-hook');
const HOOKS_DIR = join(TEST_DIR, '.git', 'hooks');
const HOOK_PATH = join(HOOKS_DIR, 'post-commit');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(HOOKS_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('installGitHook', () => {
  it('creates post-commit hook with shebang and markers', () => {
    installGitHook(TEST_DIR);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('# >>> aspens doc-sync hook (do not edit) >>>');
    expect(content).toContain('__aspens_doc_sync()');
    expect(content).toContain('# <<< aspens doc-sync hook <<<');
  });

  it('makes hook executable', () => {
    installGitHook(TEST_DIR);
    const mode = statSync(HOOK_PATH).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('uses return 0 instead of exit 0 in cooldown', () => {
    installGitHook(TEST_DIR);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('return 0');
    expect(content).not.toContain('exit 0');
  });

  it('includes logging to a file', () => {
    installGitHook(TEST_DIR);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('ASPENS_LOG=');
    expect(content).toContain('>> "$ASPENS_LOG"');
  });

  it('is idempotent — skips if already installed', () => {
    installGitHook(TEST_DIR);
    const first = readFileSync(HOOK_PATH, 'utf8');
    installGitHook(TEST_DIR);
    const second = readFileSync(HOOK_PATH, 'utf8');
    expect(second).toBe(first);
  });

  it('appends to existing hook without replacing shebang', () => {
    writeFileSync(HOOK_PATH, '#!/bin/sh\necho "other hook"\n', 'utf8');
    installGitHook(TEST_DIR);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('echo "other hook"');
    expect(content).toContain('# >>> aspens doc-sync hook');
    // Only one shebang
    expect(content.match(/^#!\/bin\/sh/gm)).toHaveLength(1);
  });
});

describe('removeGitHook', () => {
  it('removes hook file when it only contains aspens block', () => {
    installGitHook(TEST_DIR);
    expect(existsSync(HOOK_PATH)).toBe(true);
    removeGitHook(TEST_DIR);
    expect(existsSync(HOOK_PATH)).toBe(false);
  });

  it('preserves other hook content when removing aspens block', () => {
    writeFileSync(HOOK_PATH, '#!/bin/sh\necho "other hook"\n', 'utf8');
    installGitHook(TEST_DIR);
    removeGitHook(TEST_DIR);
    expect(existsSync(HOOK_PATH)).toBe(true);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('echo "other hook"');
    expect(content).not.toContain('aspens doc-sync hook');
  });

  it('handles missing hook file gracefully', () => {
    // Should not throw
    removeGitHook(TEST_DIR);
  });

  it('handles hook without aspens content gracefully', () => {
    writeFileSync(HOOK_PATH, '#!/bin/sh\necho "unrelated"\n', 'utf8');
    // Should not throw or modify
    removeGitHook(TEST_DIR);
    const content = readFileSync(HOOK_PATH, 'utf8');
    expect(content).toContain('echo "unrelated"');
  });

  it('detects legacy hooks without markers', () => {
    writeFileSync(HOOK_PATH, '#!/bin/sh\nnpx aspens doc sync --commits 1\n', 'utf8');
    // Should not delete — warns about legacy format
    removeGitHook(TEST_DIR);
    expect(existsSync(HOOK_PATH)).toBe(true);
  });
});
