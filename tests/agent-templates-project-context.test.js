import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

describe('agent templates (Phase 6: subagent context layering)', () => {
  const templatesDir = resolve(import.meta.dirname, '..', 'src', 'templates', 'agents');
  const agentFiles = readdirSync(templatesDir).filter(f => f.endsWith('.md'));

  it('every bundled agent template has a `## Project context` block', () => {
    const missing = [];
    for (const file of agentFiles) {
      const content = readFileSync(join(templatesDir, file), 'utf8');
      if (!content.includes('## Project context')) missing.push(file);
    }
    expect(missing, `Missing project-context block in: ${missing.join(', ')}`).toEqual([]);
  });

  it('no bundled template hardcodes a `skills:` frontmatter line (injection happens in customize.js)', () => {
    const offenders = [];
    for (const file of agentFiles) {
      const content = readFileSync(join(templatesDir, file), 'utf8');
      // Match `skills:` only inside the frontmatter block.
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch && /^skills:\s*/m.test(fmMatch[1])) {
        offenders.push(file);
      }
    }
    expect(offenders, `Templates must NOT carry a skills: line: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the conditional read instructions reference code-map and the domain skill pattern', () => {
    for (const file of agentFiles) {
      const content = readFileSync(join(templatesDir, file), 'utf8');
      expect(content, `${file}: missing code-map reference`).toMatch(/\.claude\/code-map\.md/);
      expect(content, `${file}: missing domain skill pattern`).toMatch(/\.claude\/skills\/<domain>/);
    }
  });
});
