import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkAgentSkillReferences } from '../src/lib/impact.js';

describe('checkAgentSkillReferences (Phase 6)', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aspens-agent-refs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty when there is no agents directory', () => {
    expect(checkAgentSkillReferences(dir)).toEqual([]);
  });

  it('returns empty when agents declare no skills frontmatter', () => {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.claude', 'agents', 'foo.md'),
      '---\nname: foo\n---\n\nbody\n',
    );
    expect(checkAgentSkillReferences(dir)).toEqual([]);
  });

  it('returns empty when every declared skill exists on disk', () => {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'skills', 'base'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'base', 'skill.md'), '---\nname: base\n---\n');
    writeFileSync(
      join(dir, '.claude', 'agents', 'foo.md'),
      '---\nname: foo\nskills: [base]\n---\n',
    );
    expect(checkAgentSkillReferences(dir)).toEqual([]);
  });

  it('reports missing skills referenced from frontmatter', () => {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.claude', 'agents', 'broken.md'),
      '---\nname: broken\nskills: [does-not-exist]\n---\n',
    );
    const out = checkAgentSkillReferences(dir);
    expect(out).toEqual([{ agent: 'broken.md', missing: ['does-not-exist'] }]);
  });

  it('reports a partial mismatch when some skills exist and others don\'t', () => {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'skills', 'base'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'base', 'skill.md'), 'x');
    writeFileSync(
      join(dir, '.claude', 'agents', 'partial.md'),
      '---\nname: partial\nskills: [base, ghost]\n---\n',
    );
    const out = checkAgentSkillReferences(dir);
    expect(out).toEqual([{ agent: 'partial.md', missing: ['ghost'] }]);
  });
});
