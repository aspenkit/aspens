import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  computeDomainCoverage,
  computeHubCoverage,
  computeDrift,
  evaluateSaveTokensHealth,
  evaluateHookHealth,
  computeHealthScore,
  computeTargetStatus,
  recommendActions,
  summarizeReport,
  summarizeMissing,
  summarizeOpportunities,
  summarizeValueComparison,
} from '../src/lib/impact.js';

const TEST_DIR = join(import.meta.dirname, 'tmp-impact');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('computeDomainCoverage', () => {
  it('counts covered and missing domains with reasons', () => {
    const coverage = computeDomainCoverage(
      [{ name: 'auth' }, { name: 'billing' }, { name: 'profile' }, { name: 'config' }],
      [
        { name: 'base', activationPatterns: [] },
        { name: 'auth', activationPatterns: [] },
        { name: 'payments-skill', activationPatterns: ['src/billing/**'] },
      ]
    );

    expect(coverage.covered).toBe(2);
    expect(coverage.total).toBe(3);
    expect(coverage.missing).toEqual(['profile']);
    expect(coverage.excluded).toEqual(['config']);
    expect(coverage.details.find(d => d.domain === 'auth')?.reason).toContain('skill');
    expect(coverage.details.find(d => d.domain === 'billing')?.reason).toContain('activation');
  });
});

describe('computeHubCoverage', () => {
  it('counts hub paths mentioned in context text', () => {
    const coverage = computeHubCoverage(
      ['src/lib/runner.js', 'src/lib/target.js', 'src/lib/errors.js'],
      'Read src/lib/runner.js first. See src/lib/errors.js for failures.'
    );

    expect(coverage.mentioned).toBe(2);
    expect(coverage.total).toBe(3);
    expect(coverage.paths).toEqual(['src/lib/runner.js', 'src/lib/errors.js']);
  });
});

describe('computeDrift', () => {
  it('finds changed files and affected domains since last update', () => {
    const drift = computeDrift(
      {
        newestSourceMtime: 300,
        files: [
          { path: 'src/auth/session.ts', mtimeMs: 300 },
          { path: 'src/lib/db.ts', mtimeMs: 250 },
          { path: 'src/billing/stripe.ts', mtimeMs: 200 },
        ],
      },
      225,
      [
        { name: 'auth', directories: ['src/auth'] },
        { name: 'billing', directories: ['src/billing'] },
      ]
    );

    expect(drift.changedCount).toBe(2);
    expect(drift.changedFiles.map(file => file.path)).toEqual(['src/auth/session.ts', 'src/lib/db.ts']);
    expect(drift.affectedDomains).toEqual(['auth']);
    expect(drift.driftMs).toBe(75);
  });
});

describe('target status and actions', () => {
  it('marks stale partial context and recommends sync + init', () => {
    const status = computeTargetStatus({
      instructionExists: true,
      skillCount: 3,
      hookHealth: { installed: true, healthy: true },
      domainCoverage: { covered: 2, total: 3 },
      drift: { changedCount: 4 },
    }, { supportsHooks: true });

    expect(status.instructions).toBe('stale');
    expect(status.domains).toBe('partial');
    expect(status.hooks).toBe('healthy');

    const actions = recommendActions({
      status,
      drift: { changedCount: 4 },
      domainCoverage: { missing: ['profile'] },
    });
    expect(actions).toEqual(['aspens doc sync', 'aspens doc init --mode chunked --domains profile']);
  });

  it('recommends rewrite when only root hub coverage is incomplete', () => {
    const actions = recommendActions({
      status: {
        instructions: 'healthy',
        domains: 'healthy',
        hooks: 'healthy',
      },
      drift: { changedCount: 0 },
      domainCoverage: { missing: [] },
      hubCoverage: { mentioned: 3, total: 5 },
    });

    expect(actions).toEqual(['aspens doc init --mode base-only --strategy rewrite']);
  });
});

describe('computeHealthScore', () => {
  it('penalizes missing instructions, coverage gaps, and drift', () => {
    const score = computeHealthScore({
      instructionExists: false,
      skillCount: 1,
      hooksInstalled: false,
      domainCoverage: { covered: 1, total: 4 },
      hubCoverage: { mentioned: 1, total: 3 },
      drift: { changedFiles: [{}, {}, {}] },
    }, { supportsHooks: true });

    expect(score).toBeLessThan(50);
  });
});

describe('summarizeReport', () => {
  it('summarizes repo status and deduplicates actions', () => {
    const summary = summarizeReport([
      {
        health: 70,
        drift: { changedCount: 3 },
        status: { instructions: 'stale', domains: 'healthy', hooks: 'healthy' },
        actions: ['aspens doc sync'],
      },
      {
        health: 90,
        drift: { changedCount: 0 },
        status: { instructions: 'healthy', domains: 'partial', hooks: 'n/a' },
        actions: ['aspens doc init --mode chunked --domains config'],
      },
    ], { newestSourceMtime: 1234 });

    expect(summary.repoStatus).toBe('partially stale');
    expect(summary.changedFiles).toBe(3);
    expect(summary.averageHealth).toBe(80);
    expect(summary.actions).toEqual(['aspens doc sync', 'aspens doc init --mode chunked --domains config']);
  });
});

describe('summarizeValueComparison', () => {
  it('describes computed artifact coverage and freshness', () => {
    const comparison = summarizeValueComparison([
      {
        instructionExists: true,
        skillCount: 17,
        domainCoverage: { covered: 6, total: 7 },
        hubCoverage: { mentioned: 1, total: 5 },
        status: { instructions: 'healthy', hooks: 'healthy' },
        drift: { changedCount: 0 },
      },
      {
        instructionExists: true,
        skillCount: 18,
        domainCoverage: { covered: 6, total: 7 },
        hubCoverage: { mentioned: 5, total: 5 },
        status: { instructions: 'healthy', hooks: 'n/a' },
        drift: { changedCount: 0 },
      },
    ]);

    expect(comparison.withoutAspens).toContain('0 generated instruction files');
    expect(comparison.withAspens).toContain('2/2 instruction files present');
    expect(comparison.withAspens).toContain('35 generated skills');
    expect(comparison.freshness).toContain('current');
    expect(comparison.automation).toContain('1/1 hook-capable target has');
  });
});

describe('summarizeOpportunities', () => {
  it('recommends optional aspens features that are not installed', () => {
    const opportunities = summarizeOpportunities(TEST_DIR, [
      { id: 'claude' },
    ], { targets: ['claude'] });

    expect(opportunities.map(item => item.command)).toEqual([
      'aspens save-tokens',
      'aspens add agent all && aspens customize agents',
      'aspens doc sync --install-hook',
    ]);
  });

  it('does not recommend save-tokens or agents when they are already installed', () => {
    mkdirSync(join(TEST_DIR, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.claude', 'agents', 'planner.md'), 'agent\n', 'utf8');

    const opportunities = summarizeOpportunities(TEST_DIR, [
      { id: 'claude' },
    ], {
      targets: ['claude'],
      saveTokens: { enabled: true },
    });

    expect(opportunities.map(item => item.command)).not.toContain('aspens save-tokens');
    expect(opportunities.map(item => item.command)).not.toContain('aspens add agent all && aspens customize agents');
    expect(opportunities.map(item => item.command)).toContain('aspens customize agents');
  });
});

describe('summarizeMissing', () => {
  it('rolls up missing hooks, stale docs, uncovered domains, and weak root context', () => {
    const items = summarizeMissing([
      {
        label: 'Claude Code',
        status: { instructions: 'stale', hooks: 'missing' },
        drift: { changedCount: 3 },
        domainCoverage: { missing: ['core'] },
        hubCoverage: { mentioned: 2, total: 5 },
      },
      {
        label: 'Codex CLI',
        status: { instructions: 'healthy', hooks: 'n/a' },
        drift: { changedCount: 0 },
        domainCoverage: { missing: ['core', 'api'] },
        hubCoverage: { mentioned: 5, total: 5 },
      },
    ]);

    expect(items.some(item => item.kind === 'stale')).toBe(true);
    expect(items.some(item => item.kind === 'hooks')).toBe(true);
    expect(items.some(item => item.kind === 'domains' && item.message.includes('core'))).toBe(true);
    expect(items.some(item => item.kind === 'root-context' && item.message.includes('Claude Code'))).toBe(true);
  });
});

describe('evaluateHookHealth', () => {
  it('detects broken hook command paths', () => {
    mkdirSync(join(TEST_DIR, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(TEST_DIR, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', 'skill-activation-prompt.sh'), '#!/bin/bash\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'skills', 'skill-rules.json'), '{}\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/missing-hook.sh"' }],
        }],
      },
    }, null, 2));

    const health = evaluateHookHealth(TEST_DIR);
    expect(health.installed).toBe(true);
    expect(health.healthy).toBe(false);
    expect(health.invalidCommands).toHaveLength(1);
    expect(health.issues.some(issue => issue.includes('broken hook commands'))).toBe(true);
  });

  it('treats subdirectory-prefixed hook commands as broken for the project root', () => {
    mkdirSync(join(TEST_DIR, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(TEST_DIR, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', 'skill-activation-prompt.sh'), '#!/bin/bash\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', 'graph-context-prompt.sh'), '#!/bin/bash\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', 'post-tool-use-tracker.sh'), '#!/bin/bash\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'skills', 'skill-rules.json'), '{}\n', 'utf8');
    writeFileSync(join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/skill-activation-prompt.sh"' }],
        }],
      },
    }, null, 2));

    const health = evaluateHookHealth(TEST_DIR);
    expect(health.healthy).toBe(false);
    expect(health.invalidCommands).toEqual(['"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/skill-activation-prompt.sh"']);
  });
});

describe('evaluateSaveTokensHealth', () => {
  const saveTokensConfig = {
    enabled: true,
    claude: { enabled: true },
  };

  it('is not configured when save-tokens config is absent', () => {
    const health = evaluateSaveTokensHealth(TEST_DIR, null);

    expect(health.configured).toBe(false);
    expect(health.healthy).toBe(true);
  });

  it('reports healthy when save-tokens files, commands, and settings are installed', () => {
    installSaveTokensFixture();

    const health = evaluateSaveTokensHealth(TEST_DIR, saveTokensConfig);

    expect(health.configured).toBe(true);
    expect(health.healthy).toBe(true);
    expect(health.issues).toEqual([]);
  });

  it('detects broken save-tokens settings and missing slash commands', () => {
    installSaveTokensFixture();
    rmSync(join(TEST_DIR, '.claude', 'commands', 'resume-handoff-latest.md'));
    writeFileSync(join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
      statusLine: {
        type: 'command',
        command: '"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/save-tokens-statusline.sh"',
      },
      hooks: {},
    }, null, 2), 'utf8');

    const health = evaluateSaveTokensHealth(TEST_DIR, saveTokensConfig);

    expect(health.healthy).toBe(false);
    expect(health.missingCommandFiles).toEqual(['resume-handoff-latest.md']);
    expect(health.invalidCommands).toEqual(['"$CLAUDE_PROJECT_DIR/backend/.claude/hooks/save-tokens-statusline.sh"']);
    expect(health.issues.some(issue => issue.includes('missing save-tokens slash commands'))).toBe(true);
    expect(health.issues.some(issue => issue.includes('missing save-tokens settings entries'))).toBe(true);
  });

  it('reports legacy save-tokens hook payloads left behind', () => {
    installSaveTokensFixture();
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', 'save-tokens-lib.mjs'), 'old\n', 'utf8');

    const health = evaluateSaveTokensHealth(TEST_DIR, saveTokensConfig);

    expect(health.healthy).toBe(false);
    expect(health.installedLegacyHookFiles).toEqual(['save-tokens-lib.mjs']);
    expect(health.issues.some(issue => issue.includes('legacy save-tokens hook files'))).toBe(true);
  });
});

function installSaveTokensFixture() {
  mkdirSync(join(TEST_DIR, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.claude', 'commands'), { recursive: true });
  for (const file of [
    'save-tokens.mjs',
    'save-tokens-statusline.sh',
    'save-tokens-prompt-guard.sh',
    'save-tokens-precompact.sh',
  ]) {
    writeFileSync(join(TEST_DIR, '.claude', 'hooks', file), '#!/bin/bash\n', 'utf8');
  }
  for (const file of [
    'save-handoff.md',
    'resume-handoff-latest.md',
    'resume-handoff.md',
  ]) {
    writeFileSync(join(TEST_DIR, '.claude', 'commands', file), 'command\n', 'utf8');
  }
  writeFileSync(join(TEST_DIR, '.claude', 'settings.json'), JSON.stringify({
    statusLine: {
      type: 'command',
      command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-statusline.sh"',
    },
    hooks: {
      UserPromptSubmit: [{
        hooks: [{
          type: 'command',
          command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-prompt-guard.sh"',
        }],
      }],
      PreCompact: [{
        hooks: [{
          type: 'command',
          command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/save-tokens-precompact.sh"',
        }],
      }],
    },
  }, null, 2), 'utf8');
}
