import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

/**
 * Phase 4: guidelines purge — no functional source path or repo doc may
 * reference the legacy `.claude/guidelines/` directory. Skills supersede it.
 *
 * `ghost-writer.md` uses the phrase "Project guidelines" with a different
 * meaning (style guidance) — it is not matched by these patterns.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..');

function gitGrep(pattern, paths) {
  try {
    const output = execSync(
      `git grep -nE "${pattern}" -- ${paths.join(' ')}`,
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return output.split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

describe('guidelines purge (Phase 4)', () => {
  it('no source or repo doc references `.claude/guidelines/`', () => {
    const matches = gitGrep('\\.claude/guidelines', ['src', '.claude']);
    expect(matches, `Unexpected guideline refs:\n${matches.join('\n')}`).toEqual([]);
  });

  it('no source path constructs a literal "guidelines" segment', () => {
    const matches = gitGrep("'guidelines'", ['src']);
    expect(matches, `Unexpected dynamic 'guidelines' constructions:\n${matches.join('\n')}`).toEqual([]);
  });

  it('no `guidelines/<filename>` path references in src or .claude', () => {
    const matches = gitGrep('guidelines/[a-z]', ['src', '.claude']);
    expect(matches, `Unexpected guidelines/<file> refs:\n${matches.join('\n')}`).toEqual([]);
  });
});
