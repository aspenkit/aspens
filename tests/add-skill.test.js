import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { addCommand } from '../src/commands/add.js';

const TEST_DIR = join(import.meta.dirname, 'tmp-add-skill');

let originalCwd;

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(TEST_DIR);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('addCommand skill scaffold', () => {
  it('creates skill.md with correct frontmatter', async () => {
    await addCommand('skill', 'my-convention', {});
    const skillPath = join(TEST_DIR, '.claude', 'skills', 'my-convention', 'skill.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf8');
    expect(content).toContain('name: my-convention');
    expect(content).toContain('description: TODO');
    expect(content).toContain('## Activation');
    expect(content).toContain('Keywords: my-convention');
  });

  it('sanitizes names with spaces', async () => {
    await addCommand('skill', 'my skill', {});
    const skillPath = join(TEST_DIR, '.claude', 'skills', 'my-skill', 'skill.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf8');
    expect(content).toContain('name: my-skill');
  });

  it('sanitizes names with uppercase', async () => {
    await addCommand('skill', 'My-Convention', {});
    const skillPath = join(TEST_DIR, '.claude', 'skills', 'my-convention', 'skill.md');
    expect(existsSync(skillPath)).toBe(true);
  });

  it('throws CliError for invalid names', async () => {
    await expect(addCommand('skill', '!!!', {})).rejects.toThrow('Invalid skill name');
  });

  it('detects duplicate and skips', async () => {
    await addCommand('skill', 'existing', {});
    const skillPath = join(TEST_DIR, '.claude', 'skills', 'existing', 'skill.md');
    const firstContent = readFileSync(skillPath, 'utf8');

    // Second call should not overwrite
    await addCommand('skill', 'existing', {});
    const secondContent = readFileSync(skillPath, 'utf8');
    expect(secondContent).toBe(firstContent);
  });

  it('creates skill in correct directory structure', async () => {
    await addCommand('skill', 'test-skill', {});
    const skillDir = join(TEST_DIR, '.claude', 'skills', 'test-skill');
    expect(existsSync(skillDir)).toBe(true);
    expect(existsSync(join(skillDir, 'skill.md'))).toBe(true);
  });

  it('includes today date in Last Updated', async () => {
    await addCommand('skill', 'dated', {});
    const content = readFileSync(
      join(TEST_DIR, '.claude', 'skills', 'dated', 'skill.md'),
      'utf8',
    );
    const today = new Date().toISOString().split('T')[0];
    expect(content).toContain(`**Last Updated:** ${today}`);
  });
});
