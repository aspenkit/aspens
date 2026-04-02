import { describe, it, expect } from 'vitest';
import { transformForTarget, validateTransformedFiles } from '../src/lib/target-transform.js';
import { TARGETS } from '../src/lib/target.js';

const mockScanResult = {
  domains: [
    { name: 'billing', directories: ['src/services/billing'], modules: [], files: [], sourceFileCount: 5 },
    { name: 'auth', directories: ['src/auth'], modules: [], files: [], sourceFileCount: 3 },
  ],
};

const mockClaudeFiles = [
  { path: '.claude/skills/base/skill.md', content: '---\nname: base\n---\n\n## Activation\n\nThis is a base skill.\n\n---\n\nBase skill content here.' },
  { path: '.claude/skills/billing/skill.md', content: '---\nname: billing\n---\n\n## Activation\n\nThis skill triggers when editing billing files:\n- src/services/billing/**\n\n---\n\nBilling conventions.' },
  { path: 'CLAUDE.md', content: '# My Project\n\nProject overview.\n\n## Commands\n\nnpm test\n' },
];

describe('transformForTarget', () => {
  it('returns files unchanged when source and dest are the same', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.claude,
      { scanResult: mockScanResult }
    );
    expect(result).toBe(mockClaudeFiles);
  });

  it('produces root AGENTS.md from base skill + CLAUDE.md when transforming claude to codex', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    const rootAgents = result.find(f => f.path === 'AGENTS.md');
    expect(rootAgents).toBeDefined();
    expect(rootAgents.content).toContain('My Project');
    expect(rootAgents.content).toContain('npm test');
  });

  it('strips activation sections from domain skills', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    const billingFile = result.find(f => f.path.includes('billing'));
    expect(billingFile).toBeDefined();
    expect(billingFile.content).not.toContain('## Activation');
    expect(billingFile.content).toContain('Billing conventions');
  });

  it('maps domain skills to source directories using scanResult.domains', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    const billingFile = result.find(f => f.path.startsWith('src/services/billing'));
    expect(billingFile).toBeDefined();
    expect(billingFile.path).toBe('src/services/billing/AGENTS.md');
  });

  it('skips domains without known directories', () => {
    const filesWithUnknownDomain = [
      ...mockClaudeFiles,
      { path: '.claude/skills/payments/skill.md', content: '---\nname: payments\n---\n\n## Activation\n\nPayments stuff.\n\n---\n\nPayments conventions.' },
    ];

    const result = transformForTarget(
      filesWithUnknownDomain,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    const paymentsFile = result.find(f => f.path.includes('payments'));
    expect(paymentsFile).toBeUndefined();
  });

  it('rewrites CLAUDE.md references to AGENTS.md in codex output', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    const rootAgents = result.find(f => f.path === 'AGENTS.md');
    expect(rootAgents.content).not.toContain('CLAUDE.md');
  });
});

describe('validateTransformedFiles', () => {
  it('passes for valid relative paths with known filenames', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: 'AGENTS.md', content: 'root' },
      { path: 'src/billing/AGENTS.md', content: 'billing' },
      { path: 'CLAUDE.md', content: 'claude' },
    ]);
    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it('catches absolute paths', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: '/etc/passwd', content: 'evil' },
    ]);
    expect(valid).toBe(false);
    expect(issues[0]).toContain('Absolute path not allowed');
  });

  it('catches Windows absolute paths', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: 'C:\\Users\\evil.md', content: 'evil' },
    ]);
    expect(valid).toBe(false);
    expect(issues[0]).toContain('Absolute path not allowed');
  });

  it('catches path traversal', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: '../../../etc/passwd', content: 'evil' },
    ]);
    expect(valid).toBe(false);
    expect(issues[0]).toContain('Path traversal not allowed');
  });

  it('catches unexpected filenames', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: 'src/random.js', content: 'stuff' },
    ]);
    expect(valid).toBe(false);
    expect(issues[0]).toContain('Unexpected filename');
  });

  it('reports multiple issues', () => {
    const { valid, issues } = validateTransformedFiles([
      { path: '/tmp/evil', content: 'a' },
      { path: '../bad/AGENTS.md', content: 'b' },
      { path: 'src/ok/AGENTS.md', content: 'c' },
    ]);
    expect(valid).toBe(false);
    expect(issues).toHaveLength(2);
  });
});
