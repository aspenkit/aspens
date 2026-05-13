import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformForTarget, validateTransformedFiles, projectCodexDomainDocs, ensureRootKeyFilesSection, syncSkillsSection, syncBehaviorSection, assertTargetParity, sanitizePublishedContent } from '../src/lib/target-transform.js';
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

// Regression: doc-sync passes only the CHANGED skills in `files`. The Skills
// section of AGENTS.md/CLAUDE.md must still list every on-disk skill — earlier
// builds were truncating the list to just the in-flight subset.
describe('transformForTarget — Skills section completeness (regression)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const fixtureRoot = join(__dirname, 'fixtures', 'skills-completeness');

  beforeAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    const skillsDir = join(fixtureRoot, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const skills = [
      ['base',    '---\nname: base\ndescription: Core conventions\n---\n\nBase content.\n'],
      ['billing', '---\nname: billing\ndescription: Stripe billing flows\n---\n\nBilling.\n'],
      ['auth',    '---\nname: auth\ndescription: JWT + Supabase auth\n---\n\nAuth.\n'],
      ['payments',  '---\nname: payments\ndescription: Webhook + checkout handling\n---\n\nPayments.\n'],
      ['profile',   '---\nname: profile\ndescription: User profile, settings, and stats\n---\n\nProfile.\n'],
      ['platform',  '---\nname: platform\ndescription: Cross-cutting infra and middleware\n---\n\nPlatform.\n'],
    ];

    for (const [name, body] of skills) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, 'skill.md'), body, 'utf8');
    }

    writeFileSync(
      join(fixtureRoot, 'CLAUDE.md'),
      '# Test Repo\n\nOverview.\n\n## Skills\n\n- `.claude/skills/base/skill.md` — old listing\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('lists every on-disk skill in AGENTS.md even when files only contains one changed skill', () => {
    // doc-sync's actual call shape after deterministic injection: when Skills/
    // Behavior drift, the canonical pass adds CLAUDE.md to baseFiles alongside
    // the changed skill. transformForTarget then projects AGENTS.md from that
    // pending CLAUDE.md (no disk-fallback emit).
    const files = [
      { path: '.claude/skills/billing/skill.md', content: '---\nname: billing\ndescription: Stripe billing flows (updated)\n---\n\nBilling (new content).\n' },
      { path: 'CLAUDE.md',                       content: '# Test Repo\n\nOverview.\n' },
    ];

    const result = transformForTarget(
      files,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: { domains: [] }, repoPath: fixtureRoot }
    );

    const rootAgents = result.find(f => f.path === 'AGENTS.md');
    expect(rootAgents).toBeDefined();

    // Every on-disk skill should appear in the Skills section.
    expect(rootAgents.content).toContain('.agents/skills/base/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/billing/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/auth/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/payments/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/profile/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/platform/SKILL.md');

    // Pending changes should win for descriptions.
    expect(rootAgents.content).toContain('Stripe billing flows (updated)');
  });

  it('falls back to pending-only Skills list when repoPath is unavailable', () => {
    const files = [
      { path: '.claude/skills/billing/skill.md', content: '---\nname: billing\ndescription: Billing\n---\n\nBilling.\n' },
      { path: '.claude/skills/base/skill.md',    content: '---\nname: base\ndescription: Base\n---\n\nBase.\n' },
      { path: 'CLAUDE.md',                       content: '# Test Repo\n\nOverview.\n' },
    ];

    const result = transformForTarget(
      files,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: { domains: [] } }
    );

    const rootAgents = result.find(f => f.path === 'AGENTS.md');
    expect(rootAgents.content).toContain('.agents/skills/base/SKILL.md');
    expect(rootAgents.content).toContain('.agents/skills/billing/SKILL.md');
  });

  it('does not emit dest instructions when source instructions are absent from files (parity)', () => {
    // doc-sync's "no drift" call shape: deterministic injection found no
    // Skills/Behavior change, so CLAUDE.md is NOT in baseFiles. The codex
    // transform must not manufacture AGENTS.md from disk fallback alone —
    // doing so creates an INSTRUCTIONS parity violation with the claude
    // target, whose output is just `[...baseFiles, ...]`.
    const files = [
      { path: '.claude/skills/billing/skill.md', content: '---\nname: billing\ndescription: Stripe billing flows\n---\n\nBilling.\n' },
    ];

    const result = transformForTarget(
      files,
      TARGETS.claude,
      TARGETS.codex,
      { scanResult: { domains: [] }, repoPath: fixtureRoot }
    );

    const rootAgents = result.find(f => f.path === 'AGENTS.md');
    expect(rootAgents).toBeUndefined();

    // The skill projection still happens.
    const skill = result.find(f => f.path === '.agents/skills/billing/SKILL.md');
    expect(skill).toBeDefined();
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

describe('ensureRootKeyFilesSection (Phase 1: legacy-only stripper)', () => {
  it('does NOT insert a key files section when missing — hub blocks are no longer emitted into root instructions', () => {
    const content = '# Backend\n\n## Commands\n\nuv run pytest\n\n## Behavior\n\n- Verify before claiming\n';
    const result = ensureRootKeyFilesSection(content, mockGraph);

    expect(result).not.toContain('## Key Files');
    expect(result).toContain('## Commands');
    expect(result).toContain('## Behavior');
  });

  it('strips a legacy hub block if present (backwards-compat one-shot)', () => {
    const content = '# Backend\n\n## Key Files\n\n- `app/core/db.py` - 9 dependents\n\n## Behavior\n';
    const result = ensureRootKeyFilesSection(content, mockGraph);

    expect(result).not.toContain('## Key Files');
    expect(result).not.toContain('9 dependents');
    expect(result).toContain('## Behavior');
  });

  it('returns content unchanged when no legacy block is present', () => {
    const content = '# Backend\n\n## Commands\n\nrun me\n';
    expect(ensureRootKeyFilesSection(content, mockGraph)).toBe(content);
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

describe('syncSkillsSection', () => {
  const baseSkill = { path: '.claude/skills/base/skill.md', content: '---\nname: base\ndescription: Base skill desc\n---\n' };
  const domainSkills = [
    { path: '.claude/skills/auth/skill.md', content: '---\nname: auth\ndescription: Auth handling\n---\n' },
    { path: '.claude/skills/billing/skill.md', content: '---\nname: billing\ndescription: Billing flows\n---\n' },
  ];

  it('injects a Skills section listing every generated skill for Claude', () => {
    const claudeMd = '# Project\n\nIntro.\n';
    const out = syncSkillsSection(claudeMd, baseSkill, domainSkills, TARGETS.claude, false);
    expect(out).toContain('## Skills');
    expect(out).toContain('.claude/skills/base/skill.md');
    expect(out).toContain('.claude/skills/auth/skill.md');
    expect(out).toContain('.claude/skills/billing/skill.md');
    expect(out).toContain('Auth handling');
    expect(out).toContain('Billing flows');
  });

  it('overwrites an existing Skills section rather than duplicating it', () => {
    const claudeMd = '# Project\n\n## Skills\n\n- only-one-stale-entry\n\n## Conventions\n\nstuff\n';
    const out = syncSkillsSection(claudeMd, baseSkill, domainSkills, TARGETS.claude, false);
    expect(out.match(/## Skills/g)).toHaveLength(1);
    expect(out).not.toContain('only-one-stale-entry');
    expect(out).toContain('.claude/skills/auth/skill.md');
    expect(out).toContain('## Conventions');
  });

  it('uses Codex paths and casing when destTarget is codex', () => {
    const agentsMd = '# Project\n';
    const out = syncSkillsSection(agentsMd, baseSkill, domainSkills, TARGETS.codex, true);
    expect(out).toContain('.agents/skills/base/SKILL.md');
    expect(out).toContain('.agents/skills/auth/SKILL.md');
    expect(out).toContain('.agents/skills/architecture/SKILL.md');
  });

  it('does not raise a parity violation for the codex-only synthetic architecture skill', () => {
    const claudeFiles = [
      { path: 'CLAUDE.md', content: '# x' },
      { path: '.claude/skills/base/skill.md', content: '---\nname: base\n---\n' },
      { path: '.claude/skills/auth/skill.md', content: '---\nname: auth\n---\n' },
    ];
    const codexFiles = [
      { path: 'AGENTS.md', content: '# x' },
      { path: '.agents/skills/base/SKILL.md', content: '---\nname: base\n---\n' },
      { path: '.agents/skills/auth/SKILL.md', content: '---\nname: auth\n---\n' },
      { path: '.agents/skills/architecture/SKILL.md', content: '---\nname: architecture\n---\n' },
    ];
    const perTarget = new Map([
      ['claude', claudeFiles],
      ['codex', codexFiles],
    ]);
    expect(() => assertTargetParity(perTarget)).not.toThrow();
  });

  it('extracts domain names when source skill paths use the Codex skillsDir', () => {
    const codexBase = { path: '.agents/skills/base/SKILL.md', content: '---\nname: base\ndescription: Base\n---\n' };
    const codexDomains = [
      { path: '.agents/skills/auth/SKILL.md', content: '---\nname: auth\ndescription: Auth\n---\n' },
      { path: '.agents/skills/billing/SKILL.md', content: '---\nname: billing\ndescription: Billing\n---\n' },
    ];
    const out = syncSkillsSection('# Project\n', codexBase, codexDomains, TARGETS.codex, false);
    expect(out).toContain('.agents/skills/auth/SKILL.md');
    expect(out).toContain('.agents/skills/billing/SKILL.md');
  });
});

describe('syncBehaviorSection', () => {
  it('appends a Behavior section with the canonical rules when missing', () => {
    const out = syncBehaviorSection('# Project\n\nIntro.\n');
    expect(out).toContain('## Behavior');
    expect(out).toContain('Verify before claiming');
    expect(out).toContain('Simplicity first');
    expect(out).toContain('Surgical changes');
  });

  it('overwrites an existing Behavior section, never duplicating it', () => {
    const input = '# Project\n\n## Behavior\n\n- stale rule\n\n## Conventions\n\nstuff\n';
    const out = syncBehaviorSection(input);
    expect(out.match(/## Behavior/g)).toHaveLength(1);
    expect(out).not.toContain('stale rule');
    expect(out).toContain('Surgical changes');
    expect(out).toContain('## Conventions');
  });
});

describe('sanitizePublishedContent', () => {
  const skillBody = [
    '# Skill',
    '',
    '## Activation',
    '',
    '- src/foo/**',
    '',
    '## Key Files',
    '',
    '- src/foo/bar.js',
    '',
    '## Real Content',
    '',
    'kept.',
  ].join('\n');

  it('strips ## Activation blocks regardless of path', () => {
    const out = sanitizePublishedContent('\n' + skillBody, '.claude/skills/foo/skill.md');
    expect(out).not.toContain('## Activation');
    expect(out).toContain('## Real Content');
  });

  it('strips ## Key Files blocks regardless of path', () => {
    const out = sanitizePublishedContent('\n' + skillBody, '.claude/skills/foo/skill.md');
    expect(out).not.toContain('## Key Files');
    expect(out).toContain('## Real Content');
  });

  it('strips data-block leaks (Hub files, Domain clusters, Hotspots, Framework entries) from skill files', () => {
    const polluted = [
      '# Skill',
      '',
      '**Hub files (most depended-on):**',
      '- src/lib/foo.js (10 dependents)',
      '',
      '**Domain clusters:**',
      '- src: src/lib/a.js, src/lib/b.js',
      '',
      '**High-churn hotspots:**',
      '- src/lib/c.js (5 changes)',
      '',
      '**Framework entry points (nextjs-app):**',
      '- src/app/page.tsx',
      '',
      '## Real Content',
      '',
      'kept.',
    ].join('\n');

    const out = sanitizePublishedContent('\n' + polluted, '.claude/skills/foo/skill.md');
    expect(out).not.toContain('**Hub files');
    expect(out).not.toContain('**Domain clusters:**');
    expect(out).not.toContain('**High-churn hotspots:**');
    expect(out).not.toContain('**Framework entry points');
    expect(out).toContain('## Real Content');
  });

  it('preserves data-block content when filePath ends with code-map.md', () => {
    const codeMap = [
      '## Codebase Structure',
      '',
      '**Domain clusters:**',
      '- **src**: `src/lib/foo.js`, `src/lib/bar.js`',
      '',
      '**Framework entry points (nextjs-app):**',
      '- `src/app/page.tsx`',
    ].join('\n');

    const out = sanitizePublishedContent('\n' + codeMap, '.claude/code-map.md');
    expect(out).toContain('**Domain clusters:**');
    expect(out).toContain('**Framework entry points');
    expect(out).toContain('src/lib/foo.js');
  });

  it('also preserves data blocks in codex references/code-map.md', () => {
    const codeMap = '\n**Domain clusters:**\n- **app**: `app/main.py`\n';
    const out = sanitizePublishedContent(codeMap, '.agents/skills/architecture/references/code-map.md');
    expect(out).toContain('**Domain clusters:**');
  });

  it('still strips Activation from code-map paths (Activation never legitimate anywhere)', () => {
    const polluted = '\n## Activation\n\nshould-go\n\n## Other\n\nkept\n';
    const out = sanitizePublishedContent(polluted, '.claude/code-map.md');
    expect(out).not.toContain('## Activation');
    expect(out).toContain('## Other');
  });

  it('returns empty content unchanged', () => {
    expect(sanitizePublishedContent('', 'whatever.md')).toBe('');
    expect(sanitizePublishedContent(null, 'whatever.md')).toBe(null);
  });

  it('works without a filePath argument (defaults to non-codemap stripping)', () => {
    const polluted = '\n**Domain clusters:**\n- thing\n';
    const out = sanitizePublishedContent(polluted);
    expect(out).not.toContain('**Domain clusters:**');
  });
});

// Regression: repairDeterministicSections feeds a Claude-shaped baseFiles array
// (just CLAUDE.md, no skills) into transformForTarget for each non-source target.
// The codex side adds a synthetic `architecture` skill when a graph is present,
// which the Claude side has no counterpart for. assertTargetParity has a
// carve-out — this test pins that behavior so the no-op repair path stays safe.
describe('Multi-target parity through the no-op repair flow', () => {
  const __dirname2 = dirname(fileURLToPath(import.meta.url));
  const fixtureRoot = join(__dirname2, 'fixtures', 'multi-target-parity');

  beforeAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    const skillsDir = join(fixtureRoot, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const skills = [
      ['base',    '---\nname: base\ndescription: Core conventions\n---\n\nBase content.\n'],
      ['billing', '---\nname: billing\ndescription: Stripe flows\n---\n\nBilling.\n'],
      ['auth',    '---\nname: auth\ndescription: JWT auth\n---\n\nAuth.\n'],
    ];
    for (const [name, body] of skills) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, 'skill.md'), body, 'utf8');
    }

    writeFileSync(
      join(fixtureRoot, 'CLAUDE.md'),
      '# Test\n\n## Skills\n\n- old stub\n\n## Behavior\n\n- placeholder\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (existsSync(fixtureRoot)) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function buildFakeGraph() {
    return {
      version: '1.0',
      meta: { generatedAt: new Date().toISOString(), gitHash: '', totalFiles: 0, totalEdges: 0 },
      files: {},
      hubs: [],
      clusters: [],
      coupling: [],
      hotspots: [],
      frameworkEntryPoints: [],
      clusterIndex: {},
    };
  }

  it('produces a parity-clean perTarget map when graph is present (codex adds architecture skill)', () => {
    const baseFiles = [{
      path: 'CLAUDE.md',
      content: '# Test\n\n## Skills\n\n- list will be replaced by syncSkillsSection\n\n## Behavior\n\n- placeholder\n',
    }];

    const claudeFiles = baseFiles; // source == dest path
    const codexFiles = transformForTarget(baseFiles, TARGETS.claude, TARGETS.codex, {
      scanResult: { domains: [] },
      graphSerialized: buildFakeGraph(),
      repoPath: fixtureRoot,
    });

    const perTarget = new Map([
      ['claude', claudeFiles],
      ['codex', codexFiles],
    ]);

    // assertTargetParity must not throw — the architecture carve-out keeps the
    // codex-only synthetic skill from creating a parity violation.
    expect(() => assertTargetParity(perTarget)).not.toThrow();

    // Codex output must contain all on-disk skills in AGENTS.md, not just the
    // (empty) pending skill set passed in.
    const agents = codexFiles.find(f => f.path === 'AGENTS.md');
    expect(agents).toBeDefined();
    expect(agents.content).toContain('.agents/skills/base/SKILL.md');
    expect(agents.content).toContain('.agents/skills/billing/SKILL.md');
    expect(agents.content).toContain('.agents/skills/auth/SKILL.md');
    expect(agents.content).toContain('.agents/skills/architecture/SKILL.md');
  });

  it('produces a parity-clean perTarget map when no graph is present (no architecture skill)', () => {
    const baseFiles = [{
      path: 'CLAUDE.md',
      content: '# Test\n\nBody.\n',
    }];

    const claudeFiles = baseFiles;
    const codexFiles = transformForTarget(baseFiles, TARGETS.claude, TARGETS.codex, {
      scanResult: { domains: [] },
      // no graphSerialized → no architecture skill
      repoPath: fixtureRoot,
    });

    const perTarget = new Map([
      ['claude', claudeFiles],
      ['codex', codexFiles],
    ]);

    expect(() => assertTargetParity(perTarget)).not.toThrow();

    const agents = codexFiles.find(f => f.path === 'AGENTS.md');
    expect(agents.content).not.toContain('.agents/skills/architecture/SKILL.md');
    expect(agents.content).toContain('.agents/skills/billing/SKILL.md');
  });
});

// Regression: sanitizeCodexInstructions used to filter out any line containing
// `CLAUDE.md`, deleting context that the substitution pass would have rewritten.
describe('sanitizeCodexInstructions (via transformForTarget) — CLAUDE.md mention rewrite', () => {
  it('rewrites CLAUDE.md mentions to AGENTS.md instead of deleting the line', () => {
    const files = [
      { path: '.claude/skills/base/skill.md', content: '---\nname: base\n---\n\nBase.\n' },
      { path: 'CLAUDE.md', content: '# Project\n\nThis project ships with CLAUDE.md describing conventions.\n\n## Notes\n\nSee CLAUDE.md sections above.\n' },
    ];

    const result = transformForTarget(files, TARGETS.claude, TARGETS.codex, { scanResult: { domains: [] } });
    const agents = result.find(f => f.path === 'AGENTS.md');
    expect(agents).toBeDefined();
    // The original sentence survives — `CLAUDE.md` is rewritten, not the line dropped.
    expect(agents.content).toContain('AGENTS.md describing conventions');
    expect(agents.content).toContain('See AGENTS.md sections above');
    // And the original token isn't left behind.
    expect(agents.content).not.toContain('CLAUDE.md');
  });
});
