import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const TEST_ROOT = join(import.meta.dirname, 'tmp-hook-runtime');
const MONOREPO_ROOT = join(TEST_ROOT, 'tutor');
const PROJECT_ROOT = join(MONOREPO_ROOT, 'frontend');
const HOOKS_DIR = join(PROJECT_ROOT, '.claude', 'hooks');
const SKILLS_DIR = join(PROJECT_ROOT, '.claude', 'skills');

beforeEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(HOOKS_DIR, { recursive: true });
  mkdirSync(join(SKILLS_DIR, 'base'), { recursive: true });

  const templatesDir = join(import.meta.dirname, '..', 'src', 'templates', 'hooks');
  for (const file of ['skill-activation-prompt.sh', 'skill-activation-prompt.mjs']) {
    const src = join(templatesDir, file);
    const dest = join(HOOKS_DIR, file);
    writeFileSync(dest, readFileSync(src, 'utf8'));
    if (file.endsWith('.sh')) chmodSync(dest, 0o755);
  }

  writeFileSync(join(SKILLS_DIR, 'base', 'skill.md'), `---
name: base
description: Base skill
---

## Activation

This is a **base skill** that always loads when working in this repository.

---

Base content
`, 'utf8');

  writeFileSync(join(SKILLS_DIR, 'skill-rules.json'), JSON.stringify({
    version: '2.0',
    skills: {
      base: {
        type: 'base',
        priority: 'critical',
        scope: 'all',
        alwaysActivate: true,
        filePatterns: [],
        promptTriggers: { keywords: [], intentPatterns: [] },
      },
    },
  }, null, 2));
});

afterAll(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe('skill activation hook runtime', () => {
  it('runs successfully from a monorepo subproject', () => {
    const scriptPath = join(HOOKS_DIR, 'skill-activation-prompt.sh');
    const result = spawnSync('bash', [scriptPath], {
      input: JSON.stringify({ prompt: 'help me with auth' }),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: MONOREPO_ROOT,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Hook error');
    expect(result.stdout).toContain('ACTIVE SKILLS');
    expect(result.stdout).toContain('Base content');
  });

  it('strips the ## Activation block from injected skill content', () => {
    const scriptPath = join(HOOKS_DIR, 'skill-activation-prompt.sh');
    const result = spawnSync('bash', [scriptPath], {
      input: JSON.stringify({ prompt: 'anything' }),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: MONOREPO_ROOT,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Base content');
    expect(result.stdout).not.toContain('## Activation');
    expect(result.stdout).not.toContain('always loads when working in this repository');
  });
});
