import { describe, it, expect } from 'vitest';
import { loadPrompt } from '../src/lib/runner.js';

describe('loadPrompt', () => {
  it('loads doc-init prompt', () => {
    const prompt = loadPrompt('doc-init');
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('skill files');
  });

  it('resolves {{skill-format}} partial', () => {
    const prompt = loadPrompt('doc-init');
    expect(prompt).toContain('YAML frontmatter');
    expect(prompt).not.toContain('{{skill-format}}');
  });

  it('resolves {{examples}} partial', () => {
    const prompt = loadPrompt('doc-init');
    expect(prompt).toContain('Example: Base skill');
    expect(prompt).not.toContain('{{examples}}');
  });

  it('loads doc-sync prompt', () => {
    const prompt = loadPrompt('doc-sync');
    expect(prompt).toContain('git diff');
    expect(prompt).toContain('Preserve');
  });

  it('loads doc-init-domain prompt with variables', () => {
    const prompt = loadPrompt('doc-init-domain', { domainName: 'billing' });
    expect(prompt).toContain('billing');
    expect(prompt).not.toContain('{{domainName}}');
  });

  it('loads customize-agents prompt', () => {
    const prompt = loadPrompt('customize-agents');
    expect(prompt).toContain('Tech stack');
    expect(prompt).toContain('customize');
  });

  it('has zero unresolved partials in doc-init', () => {
    const prompt = loadPrompt('doc-init');
    const unresolved = prompt.match(/\{\{[a-z-]+\}\}/g) || [];
    expect(unresolved).toHaveLength(0);
  });

  it('throws on non-existent prompt', () => {
    expect(() => loadPrompt('does-not-exist')).toThrow();
  });
});
