/**
 * Regression coverage for repairDeterministicSections.
 *
 * The function runs on every "no diffs" or "no code-bearing changes" sync to
 * heal `## Skills` / `## Behavior` drift in CLAUDE.md/AGENTS.md. Two paths
 * matter:
 *  1. Write-skip — when on-disk content already matches the deterministic
 *     output, the function must return `[]` and write nothing.
 *  2. Repair — when sections are missing or stale, the function must rebuild
 *     and write across every configured target.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { repairDeterministicSections } from '../src/commands/doc-sync.js';
import { TARGETS } from '../src/lib/target.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(__dirname, 'fixtures', 'doc-sync-repair');

function seedSkillsAndInstructions(opts = {}) {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
  const skillsDir = join(fixtureRoot, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });

  const skills = [
    ['base',    '---\nname: base\ndescription: Core conventions\n---\n\nBase.\n'],
    ['billing', '---\nname: billing\ndescription: Stripe billing flows\n---\n\nBilling.\n'],
    ['auth',    '---\nname: auth\ndescription: JWT auth\n---\n\nAuth.\n'],
  ];
  for (const [name, body] of skills) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, 'skill.md'), body, 'utf8');
  }

  const instructionsPath = join(fixtureRoot, 'CLAUDE.md');
  writeFileSync(instructionsPath, opts.instructionsContent ?? '# Test\n\nOverview.\n', 'utf8');

  return { instructionsPath };
}

afterAll(() => {
  if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('repairDeterministicSections', () => {
  it('returns [] and writes nothing on a second call once the file is already canonical', () => {
    seedSkillsAndInstructions();

    // First call: heals the stub CLAUDE.md, must write.
    const first = repairDeterministicSections(
      fixtureRoot,
      TARGETS.claude,
      [TARGETS.claude],
      { domains: [] },
    );
    expect(first.length).toBeGreaterThan(0);

    // Second call: content already matches deterministic output → zero writes.
    const canonical = readFileSync(join(fixtureRoot, 'CLAUDE.md'), 'utf8');
    const second = repairDeterministicSections(
      fixtureRoot,
      TARGETS.claude,
      [TARGETS.claude],
      { domains: [] },
    );
    expect(second).toEqual([]);
    expect(readFileSync(join(fixtureRoot, 'CLAUDE.md'), 'utf8')).toBe(canonical);
  });

  it('returns [] when the instructions file does not exist', () => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    mkdirSync(fixtureRoot, { recursive: true });

    const result = repairDeterministicSections(
      fixtureRoot,
      TARGETS.claude,
      [TARGETS.claude],
      { domains: [] },
    );

    expect(result).toEqual([]);
  });

  it('rewrites CLAUDE.md when the Skills section is stale', () => {
    seedSkillsAndInstructions({
      instructionsContent: [
        '# Test',
        '',
        '## Skills',
        '',
        '- old stale entry',
        '',
        '## Behavior',
        '',
        '- something',
      ].join('\n'),
    });

    const result = repairDeterministicSections(
      fixtureRoot,
      TARGETS.claude,
      [TARGETS.claude],
      { domains: [] },
    );

    expect(result.length).toBeGreaterThan(0);
    const claudeMd = readFileSync(join(fixtureRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('.claude/skills/base/skill.md');
    expect(claudeMd).toContain('.claude/skills/billing/skill.md');
    expect(claudeMd).toContain('.claude/skills/auth/skill.md');
    expect(claudeMd).not.toContain('old stale entry');
  });
});
