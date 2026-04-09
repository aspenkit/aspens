import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { writeSkillFiles, mergeSettings } from '../src/lib/skill-writer.js';

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

describe('mergeSettings', () => {
  it('replaces stale graph-context hook commands during merge', () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/graph-context-prompt.sh"',
              },
            ],
          },
        ],
      },
    };
    const template = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/frontend/.claude/hooks/graph-context-prompt.sh"',
              },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(existing, template);
    const commands = merged.hooks.UserPromptSubmit.flatMap(entry => entry.hooks.map(hook => hook.command));
    expect(commands).toContain('"$CLAUDE_PROJECT_DIR/frontend/.claude/hooks/graph-context-prompt.sh"');
    expect(commands).not.toContain('"$CLAUDE_PROJECT_DIR/.claude/hooks/graph-context-prompt.sh"');
  });

  it('deduplicates duplicate aspens hook entries during merge', () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/graph-context-prompt.sh"',
              },
            ],
          },
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/graph-context-prompt.sh"',
              },
            ],
          },
        ],
      },
    };
    const template = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/graph-context-prompt.sh"',
              },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(existing, template);
    expect(merged.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('treats save-tokens hooks as aspens-managed during merge', () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-prompt-guard.sh"',
              },
            ],
          },
        ],
      },
    };
    const template = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-prompt-guard.sh"',
              },
            ],
          },
        ],
      },
    };

    const merged = mergeSettings(existing, template);
    expect(merged.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('adds aspens statusLine when none exists', () => {
    const merged = mergeSettings({ hooks: {} }, {
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-statusline.sh"',
      },
    });

    expect(merged.statusLine.command).toContain('save-tokens-statusline.sh');
  });

  it('preserves a non-aspens custom statusLine', () => {
    const merged = mergeSettings({
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/my-statusline.sh"',
      },
    }, {
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-statusline.sh"',
      },
    });

    expect(merged.statusLine.command).toContain('my-statusline.sh');
  });

  it('preserves a non-aspens custom statusLine even when the template has a different non-aspens statusLine', () => {
    const merged = mergeSettings({
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/my-statusline.sh"',
      },
    }, {
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/vendor-statusline.sh"',
      },
    });

    expect(merged.statusLine.command).toContain('my-statusline.sh');
  });
});
