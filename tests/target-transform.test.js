import { describe, it, expect } from 'vitest';
import { transformForTarget, validateTransformedFiles, projectCodexDomainDocs, ensureRootKeyFilesSection } from '../src/lib/target-transform.js';
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

const mockGraph = {
  hubs: [
    { path: 'app/core/db.py', fanIn: 9 },
    { path: 'app/core/cache_service.py', fanIn: 7 },
    { path: 'app/middleware/rate_limit.py', fanIn: 6 },
  ],
};

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

    const billingFile = result.find(f => f.path === 'src/services/billing/AGENTS.md');
    expect(billingFile).toBeDefined();
    expect(billingFile.content).not.toContain('## Activation');
    expect(billingFile.content).toContain('Billing conventions');
  });

  it('mirrors base and domain skills into .agents/skills for codex', () => {
    const result = transformForTarget(
      mockClaudeFiles,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: mockScanResult }
    );

    expect(result.find(f => f.path === '.agents/skills/base/SKILL.md')).toBeDefined();
    const billingSkill = result.find(f => f.path === '.agents/skills/billing/SKILL.md');
    expect(billingSkill).toBeDefined();
    expect(billingSkill.content).toContain('## Activation');
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

  it('skips directory-scoped AGENTS.md for domains without known directories', () => {
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

    // No directory-scoped AGENTS.md for payments (unknown source dir)
    const paymentsDirDoc = result.find(f => f.path.endsWith('payments/AGENTS.md') && !f.path.startsWith('.agents'));
    expect(paymentsDirDoc).toBeUndefined();

    // But it should still mirror into .agents/skills/payments/SKILL.md
    const paymentsSkill = result.find(f => f.path.includes('.agents/skills/payments'));
    expect(paymentsSkill).toBeDefined();
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

describe('projectCodexDomainDocs', () => {
  it('projects codex skills into directory AGENTS docs', () => {
    const files = [
      { path: '.agents/skills/billing/SKILL.md', content: '---\nname: billing\n---\n\n## Activation\n- `src/services/billing/**`\n\n---\n\nBilling conventions.\n' },
      { path: '.agents/skills/base/SKILL.md', content: 'base' },
    ];

    const result = projectCodexDomainDocs(files, TARGETS.codex, mockScanResult);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/services/billing/AGENTS.md');
    expect(result[0].content).toContain('Billing conventions');
    expect(result[0].content).not.toContain('## Activation');
  });
});

describe('ensureRootKeyFilesSection', () => {
  it('inserts a key files section before behavior when missing', () => {
    const content = '# Backend\n\n## Commands\n\nuv run pytest\n\n## Behavior\n\n- Verify before claiming\n';
    const result = ensureRootKeyFilesSection(content, mockGraph);

    expect(result).toContain('## Key Files');
    expect(result).toContain('`app/core/cache_service.py`');
    expect(result.indexOf('## Key Files')).toBeLessThan(result.indexOf('## Behavior'));
  });

  it('replaces an incomplete key files section with all top hubs', () => {
    const content = '# Backend\n\n## Key Files\n\n- `app/core/db.py` - 9 dependents\n\n## Behavior\n';
    const result = ensureRootKeyFilesSection(content, mockGraph);

    expect(result).toContain('`app/core/db.py` - 9 dependents');
    expect(result).toContain('`app/core/cache_service.py` - 7 dependents');
    expect(result).toContain('`app/middleware/rate_limit.py` - 6 dependents');
    expect(result.match(/## Key Files/g)).toHaveLength(1);
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
