import { describe, it, expect } from 'vitest';
import { parseFileOutput } from '../src/lib/runner.js';

describe('parseFileOutput', () => {
  describe('XML tag format (primary)', () => {
    it('parses single file', () => {
      const output = '<file path=".claude/skills/base/skill.md">\n---\nname: base\n---\nHello\n</file>';
      const files = parseFileOutput(output);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('.claude/skills/base/skill.md');
      expect(files[0].content).toContain('name: base');
    });

    it('parses multiple files', () => {
      const output = `
<file path=".claude/skills/base/skill.md">
base content
</file>

<file path=".claude/skills/auth/skill.md">
auth content
</file>

<file path="CLAUDE.md">
# My App
</file>`;
      const files = parseFileOutput(output);
      expect(files).toHaveLength(3);
      expect(files[0].path).toBe('.claude/skills/base/skill.md');
      expect(files[1].path).toBe('.claude/skills/auth/skill.md');
      expect(files[2].path).toBe('CLAUDE.md');
    });

    it('preserves code blocks inside skills', () => {
      const output = `<file path=".claude/skills/base/skill.md">
---
name: base
---

## Commands
\`\`\`bash
npm run dev
npm run test
\`\`\`

## Structure
- src/ — source
</file>`;
      const files = parseFileOutput(output);
      expect(files).toHaveLength(1);
      expect(files[0].content).toContain('npm run dev');
      expect(files[0].content).toContain('npm run test');
      expect(files[0].content).toContain('## Structure');
    });

    it('handles single and double quotes in path', () => {
      const single = `<file path='.claude/skills/base/skill.md'>\ncontent\n</file>`;
      const double = `<file path=".claude/skills/base/skill.md">\ncontent\n</file>`;
      expect(parseFileOutput(single)).toHaveLength(1);
      expect(parseFileOutput(double)).toHaveLength(1);
    });
  });

  describe('HTML comment fallback', () => {
    it('parses when XML tags fail', () => {
      const output = '<!-- file: .claude/skills/base/skill.md -->\nsome long content here with enough chars\n\n<!-- file: CLAUDE.md -->\n# My Project with enough content';
      const files = parseFileOutput(output);
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('.claude/skills/base/skill.md');
      expect(files[1].path).toBe('CLAUDE.md');
    });

    it('skips short content in fallback', () => {
      const output = '<!-- file: .claude/skills/base/skill.md -->\nhi';
      const files = parseFileOutput(output);
      expect(files).toHaveLength(0); // < 10 chars
    });
  });

  describe('path sanitization', () => {
    it('blocks path traversal', () => {
      const output = '<file path="../../../etc/passwd">\nmalicious\n</file>';
      expect(parseFileOutput(output)).toHaveLength(0);
    });

    it('blocks absolute paths', () => {
      const output = '<file path="/tmp/evil">\nmalicious\n</file>';
      expect(parseFileOutput(output)).toHaveLength(0);
    });

    it('blocks paths outside .claude/ and CLAUDE.md', () => {
      const output = '<file path="src/random.js">\nstuff\n</file>';
      expect(parseFileOutput(output)).toHaveLength(0);
    });

    it('blocks CLAUDE.md.bak (exact match only)', () => {
      const output = '<file path="CLAUDE.md.bak">\nstuff\n</file>';
      expect(parseFileOutput(output)).toHaveLength(0);
    });

    it('allows CLAUDE.md exactly', () => {
      const output = '<file path="CLAUDE.md">\n# Project\n</file>';
      const files = parseFileOutput(output);
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('CLAUDE.md');
    });

    it('allows .claude/ prefix', () => {
      const output = '<file path=".claude/skills/billing/skill.md">\ncontent\n</file>';
      const files = parseFileOutput(output);
      expect(files).toHaveLength(1);
    });

    it('allows .claude/agents/ prefix', () => {
      const output = '<file path=".claude/agents/reviewer.md">\ncontent\n</file>';
      expect(parseFileOutput(output)).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for garbage input', () => {
      expect(parseFileOutput('just some random text')).toHaveLength(0);
    });

    it('returns empty array for empty string', () => {
      expect(parseFileOutput('')).toHaveLength(0);
    });

    it('handles file with only whitespace content', () => {
      const output = '<file path=".claude/skills/base/skill.md">\n   \n</file>';
      const files = parseFileOutput(output);
      // Content is trimmed, so it's just whitespace → still a file
      expect(files).toHaveLength(1);
    });
  });
});
