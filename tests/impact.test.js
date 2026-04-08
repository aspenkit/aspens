import { describe, it, expect } from 'vitest';
import {
  computeDomainCoverage,
  computeHubCoverage,
  computeDrift,
  computeHealthScore,
  computeTargetStatus,
  recommendActions,
  summarizeReport,
} from '../src/lib/impact.js';

describe('computeDomainCoverage', () => {
  it('counts covered and missing domains with reasons', () => {
    const coverage = computeDomainCoverage(
      [{ name: 'auth' }, { name: 'billing' }, { name: 'profile' }],
      [
        { name: 'base', activationPatterns: [] },
        { name: 'auth', activationPatterns: [] },
        { name: 'payments-skill', activationPatterns: ['src/billing/**'] },
      ]
    );

    expect(coverage.covered).toBe(2);
    expect(coverage.total).toBe(3);
    expect(coverage.missing).toEqual(['profile']);
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
      hooksInstalled: true,
      domainCoverage: { covered: 2, total: 3 },
      drift: { changedCount: 4 },
    }, { supportsHooks: true });

    expect(status.instructions).toBe('stale');
    expect(status.domains).toBe('partial');
    expect(status.hooks).toBe('healthy');

    const actions = recommendActions({
      status,
      drift: { changedCount: 4 },
    });
    expect(actions).toEqual(['aspens doc sync', 'aspens doc init --recommended']);
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
        actions: ['aspens doc init --recommended'],
      },
    ], { newestSourceMtime: 1234 });

    expect(summary.repoStatus).toBe('partially stale');
    expect(summary.changedFiles).toBe(3);
    expect(summary.averageHealth).toBe(80);
    expect(summary.actions).toEqual(['aspens doc sync', 'aspens doc init --recommended']);
  });
});
