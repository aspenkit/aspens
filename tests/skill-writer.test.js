import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { writeSkillFiles } from '../src/lib/skill-writer.js';

const TEST_DIR = join(import.meta.dirname, 'tmp-writer');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('writeSkillFiles', () => {
  const sampleFiles = [
    { path: '.claude/skills/base/skill.md', content: '---\nname: base\n---\nTest\n' },
    { path: 'CLAUDE.md', content: '# Test Project\n' },
  ];

  describe('create mode', () => {
    it('creates files and directories', () => {
      const results = writeSkillFiles(TEST_DIR, sampleFiles);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('created');
      expect(results[1].status).toBe('created');
      expect(existsSync(join(TEST_DIR, '.claude/skills/base/skill.md'))).toBe(true);
      expect(existsSync(join(TEST_DIR, 'CLAUDE.md'))).toBe(true);
    });

    it('writes correct content', () => {
      writeSkillFiles(TEST_DIR, sampleFiles);
      const content = readFileSync(join(TEST_DIR, '.claude/skills/base/skill.md'), 'utf8');
      expect(content).toBe('---\nname: base\n---\nTest\n');
    });
  });

  describe('skip mode (no force)', () => {
    it('skips existing files without force', () => {
      writeSkillFiles(TEST_DIR, sampleFiles); // first write
      const results = writeSkillFiles(TEST_DIR, sampleFiles); // second write
      expect(results[0].status).toBe('skipped');
      expect(results[0].reason).toContain('already exists');
    });
  });

  describe('force mode', () => {
    it('overwrites existing files with force', () => {
      writeSkillFiles(TEST_DIR, sampleFiles);
      const newFiles = [{ path: '.claude/skills/base/skill.md', content: 'UPDATED\n' }];
      const results = writeSkillFiles(TEST_DIR, newFiles, { force: true });
      expect(results[0].status).toBe('overwritten');
      const content = readFileSync(join(TEST_DIR, '.claude/skills/base/skill.md'), 'utf8');
      expect(content).toBe('UPDATED\n');
    });
  });

  describe('dry-run mode', () => {
    it('does not write files in dry-run', () => {
      const results = writeSkillFiles(TEST_DIR, sampleFiles, { dryRun: true });
      expect(results[0].status).toBe('would-create');
      expect(existsSync(join(TEST_DIR, '.claude/skills/base/skill.md'))).toBe(false);
    });

    it('reports would-skip for existing files without force', () => {
      writeSkillFiles(TEST_DIR, sampleFiles); // create first
      const results = writeSkillFiles(TEST_DIR, sampleFiles, { dryRun: true });
      expect(results[0].status).toBe('would-skip');
    });

    it('reports would-overwrite for existing files with force', () => {
      writeSkillFiles(TEST_DIR, sampleFiles); // create first
      const results = writeSkillFiles(TEST_DIR, sampleFiles, { dryRun: true, force: true });
      expect(results[0].status).toBe('would-overwrite');
    });
  });
});
