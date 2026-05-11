import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { computeHubCoverage } from '../src/lib/impact.js';

describe('computeHubCoverage (Phase 4: code-map check)', () => {
  let dir;
  const claudeTarget = { id: 'claude' };
  const codexTarget = { id: 'codex' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aspens-impact-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports mentioned hubs when code-map.md contains them', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(
      join(dir, '.claude', 'code-map.md'),
      '## Codebase Structure\n\nstuff `src/lib/scanner.js` and `src/commands/foo.js`\n',
    );
    const result = computeHubCoverage(
      ['src/lib/scanner.js', 'src/commands/foo.js', 'src/missing.js'],
      'irrelevant context',
      { repoPath: dir, target: claudeTarget },
    );
    expect(result.total).toBe(3);
    expect(result.mentioned).toBe(2);
    expect(result.codeMapMissing).toBe(false);
    expect(result.paths).toContain('src/lib/scanner.js');
    expect(result.paths).toContain('src/commands/foo.js');
  });

  it('reports zero mentioned when code-map.md exists but contains no hubs', () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'code-map.md'), '## Codebase Structure\n\nNo hubs here.\n');
    const result = computeHubCoverage(
      ['src/lib/scanner.js'],
      '',
      { repoPath: dir, target: claudeTarget },
    );
    expect(result.total).toBe(1);
    expect(result.mentioned).toBe(0);
    expect(result.codeMapMissing).toBe(false);
  });

  it('flags codeMapMissing when code-map.md is absent (Claude)', () => {
    const result = computeHubCoverage(
      ['src/lib/scanner.js'],
      '',
      { repoPath: dir, target: claudeTarget },
    );
    expect(result.codeMapMissing).toBe(true);
    expect(result.mentioned).toBe(0);
  });

  it('checks the Codex-specific code-map path when target is codex', () => {
    mkdirSync(join(dir, '.agents', 'skills', 'architecture', 'references'), { recursive: true });
    writeFileSync(
      join(dir, '.agents', 'skills', 'architecture', 'references', 'code-map.md'),
      '# Code Map\n\n`src/lib/codex_hub.py`\n',
    );
    const result = computeHubCoverage(
      ['src/lib/codex_hub.py'],
      '',
      { repoPath: dir, target: codexTarget },
    );
    expect(result.codeMapMissing).toBe(false);
    expect(result.mentioned).toBe(1);
  });

  it('flags codeMapMissing for codex when its code-map is absent', () => {
    const result = computeHubCoverage(
      ['x'], '',
      { repoPath: dir, target: codexTarget },
    );
    expect(result.codeMapMissing).toBe(true);
  });

  it('falls back to contextText when no opts are passed (back-compat)', () => {
    const result = computeHubCoverage(
      ['src/lib/scanner.js'],
      'CLAUDE.md content references `src/lib/scanner.js` directly',
    );
    expect(result.mentioned).toBe(1);
    expect(result.codeMapMissing).toBe(false);
  });

  it('returns total=0 with no hub paths', () => {
    const result = computeHubCoverage([], '', { repoPath: dir, target: claudeTarget });
    expect(result.total).toBe(0);
    expect(result.mentioned).toBe(0);
  });
});
