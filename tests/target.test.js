import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  TARGETS,
  resolveTarget,
  resolveTargets,
  getAllowedPaths,
  readConfig,
  writeConfig,
} from '../src/lib/target.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'target');

beforeAll(() => {
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup race with other test files */ }
});

describe('resolveTarget', () => {
  it('returns claude target for "claude"', () => {
    const target = resolveTarget('claude');
    expect(target.id).toBe('claude');
    expect(target.label).toBe('Claude Code');
    expect(target.instructionsFile).toBe('CLAUDE.md');
  });

  it('returns codex target for "codex"', () => {
    const target = resolveTarget('codex');
    expect(target.id).toBe('codex');
    expect(target.label).toBe('Codex CLI');
    expect(target.instructionsFile).toBe('AGENTS.md');
    expect(target.supportsSettings).toBe(false);
    expect(target.supportsMCP).toBe(false);
  });

  it('throws for unknown target', () => {
    expect(() => resolveTarget('invalid')).toThrow('Unknown target: "invalid"');
  });
});

describe('resolveTargets', () => {
  it('returns both targets for "all"', () => {
    const targets = resolveTargets('all');
    expect(targets).toHaveLength(2);
    const ids = targets.map(t => t.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
  });

  it('returns array with claude only for "claude"', () => {
    const targets = resolveTargets('claude');
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe('claude');
  });

  it('returns array with codex only for "codex"', () => {
    const targets = resolveTargets('codex');
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe('codex');
  });
});

describe('getAllowedPaths', () => {
  it('returns .claude/ prefix and CLAUDE.md for claude target', () => {
    const { dirPrefixes, exactFiles } = getAllowedPaths([TARGETS.claude]);
    expect(dirPrefixes).toContain('.claude/');
    expect(exactFiles).toContain('CLAUDE.md');
  });

  it('returns .agents/ and .codex/ prefixes and AGENTS.md for codex target', () => {
    const { dirPrefixes, exactFiles } = getAllowedPaths([TARGETS.codex]);
    expect(dirPrefixes).toContain('.agents/');
    expect(dirPrefixes).toContain('.codex/');
    expect(exactFiles).toContain('AGENTS.md');
  });

  it('returns union of both targets', () => {
    const { dirPrefixes, exactFiles } = getAllowedPaths([TARGETS.claude, TARGETS.codex]);
    expect(dirPrefixes).toContain('.claude/');
    expect(dirPrefixes).toContain('.agents/');
    expect(dirPrefixes).toContain('.codex/');
    expect(exactFiles).toContain('CLAUDE.md');
    expect(exactFiles).toContain('AGENTS.md');
  });
});

describe('config persistence', () => {
  it('returns null for missing config file', () => {
    const result = readConfig(join(FIXTURES_DIR, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('round-trips writeConfig + readConfig', () => {
    const dir = join(FIXTURES_DIR, 'config-roundtrip');
    mkdirSync(dir, { recursive: true });

    writeConfig(dir, { targets: ['claude', 'codex'], backend: 'claude' });
    const config = readConfig(dir);

    expect(config).not.toBeNull();
    expect(config.targets).toEqual(['claude', 'codex']);
    expect(config.backend).toBe('claude');
    expect(config.version).toBe('1.0');
  });

  it('defaults backend to null when not provided', () => {
    const dir = join(FIXTURES_DIR, 'config-no-backend');
    mkdirSync(dir, { recursive: true });

    writeConfig(dir, { targets: ['claude'] });
    const config = readConfig(dir);

    expect(config.backend).toBeNull();
  });
});
