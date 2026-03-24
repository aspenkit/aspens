import { describe, it, expect } from 'vitest';
import { getActivationBlock, fileMatchesActivation, GENERIC_PATH_SEGMENTS } from '../src/lib/skill-reader.js';
import { skillToDomain } from '../src/commands/doc-sync.js';

describe('getActivationBlock', () => {
  it('extracts and lowercases the activation section', () => {
    const content = `---
name: test
---

## Activation

- \`src/lib/Scanner.js\`
- \`src/commands/Doc-Init.js\`

Keywords: scanning

---

You are working on scanning.`;

    const block = getActivationBlock(content);
    expect(block).toContain('scanner.js');
    expect(block).toContain('doc-init.js');
    expect(block).not.toContain('Scanner.js'); // lowercased
  });

  it('stops at next ## heading', () => {
    const content = `## Activation

- \`src/lib/runner.js\`

## Key Files

- \`src/lib/other.js\``;

    const block = getActivationBlock(content);
    expect(block).toContain('runner.js');
    expect(block).not.toContain('other.js');
  });

  it('returns empty string when no activation section', () => {
    expect(getActivationBlock('# Just a title\nSome content')).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    expect(getActivationBlock(null)).toBe('');
    expect(getActivationBlock(undefined)).toBe('');
    expect(getActivationBlock('')).toBe('');
  });
});

describe('fileMatchesActivation', () => {
  const block = '## activation\n- `src/lib/scanner.js`\n- `src/commands/doc-init.js`\nkeywords: scanning, graph-builder';

  it('matches by filename', () => {
    expect(fileMatchesActivation('src/lib/scanner.js', block)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(fileMatchesActivation('src/lib/Scanner.js', block)).toBe(true);
  });

  it('matches by meaningful path segment', () => {
    // "scanner" appears in the block as part of "scanner.js"
    expect(fileMatchesActivation('other/scanner/index.js', block)).toBe(true);
  });

  it('does not match generic segments', () => {
    // "src" and "lib" are generic — they shouldn't trigger a match on their own
    const narrowBlock = '## activation\nkeywords: specific-thing';
    expect(fileMatchesActivation('src/lib/unrelated.js', narrowBlock)).toBe(false);
  });

  it('filters segments shorter than 3 chars', () => {
    const narrowBlock = '## activation\n- `xx/thing.js`';
    // "xx" is only 2 chars, should be ignored
    expect(fileMatchesActivation('xx/other.js', narrowBlock)).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(fileMatchesActivation('totally/unrelated/file.py', block)).toBe(false);
  });

  it('accepts custom generic segments set', () => {
    const customGeneric = new Set(['custom']);
    const narrowBlock = '## activation\n- `custom/thing.js`';
    // "custom" is in the generic set, so only "thing.js" or meaningful segments should match
    expect(fileMatchesActivation('custom/other.js', narrowBlock, customGeneric)).toBe(false);
    expect(fileMatchesActivation('custom/thing.js', narrowBlock, customGeneric)).toBe(true);
  });

  it('returns false for empty filePath', () => {
    expect(fileMatchesActivation('', block)).toBe(false);
  });

  it('returns false for empty activationBlock', () => {
    expect(fileMatchesActivation('src/lib/scanner.js', '')).toBe(false);
  });

  it('returns false for null/undefined inputs', () => {
    expect(fileMatchesActivation(null, block)).toBe(false);
    expect(fileMatchesActivation('src/lib/scanner.js', null)).toBe(false);
  });
});

describe('skillToDomain', () => {
  function makeSkill(name, activationLines) {
    const content = `---
name: ${name}
description: test
---

## Activation

${activationLines.map(l => `- \`${l}\``).join('\n')}

---

Content here.`;
    return { name, content };
  }

  it('extracts directories from glob patterns', () => {
    const domain = skillToDomain(makeSkill('test', ['src/lib/*.js', 'src/commands/**/*']));
    expect(domain.directories).toContain('src/lib');
    expect(domain.directories).toContain('src/commands');
    expect(domain.files).toHaveLength(0);
  });

  it('extracts files and directories from exact paths', () => {
    const domain = skillToDomain(makeSkill('test', ['src/lib/scanner.js', 'bin/cli.js']));
    expect(domain.files).toContain('src/lib/scanner.js');
    expect(domain.files).toContain('bin/cli.js');
    expect(domain.directories).toContain('src/lib');
    expect(domain.directories).toContain('bin');
  });

  it('returns empty arrays for skills with no activation patterns', () => {
    const skill = { name: 'empty', content: '---\nname: empty\n---\n\nNo activation section.' };
    const domain = skillToDomain(skill);
    expect(domain.directories).toHaveLength(0);
    expect(domain.files).toHaveLength(0);
  });

  it('deduplicates directories', () => {
    const domain = skillToDomain(makeSkill('test', ['src/lib/a.js', 'src/lib/b.js']));
    const libCount = domain.directories.filter(d => d === 'src/lib').length;
    expect(libCount).toBe(1);
  });

  it('sets the skill name on the domain', () => {
    const domain = skillToDomain(makeSkill('my-skill', ['src/lib/*.js']));
    expect(domain.name).toBe('my-skill');
  });
});
