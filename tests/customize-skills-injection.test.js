import { describe, it, expect } from 'vitest';
import { maybeInjectBaseSkill } from '../src/commands/customize.js';

describe('maybeInjectBaseSkill (Phase 6: skills frontmatter injection)', () => {
  const sampleAgent = '---\nname: my-agent\nmodel: sonnet\n---\n\nBody of the agent.\n';

  it('does nothing when base skill is absent', () => {
    expect(maybeInjectBaseSkill(sampleAgent, false, false)).toBe(sampleAgent);
  });

  it('does nothing when content has no frontmatter', () => {
    const noFm = 'Just a body, no frontmatter.\n';
    expect(maybeInjectBaseSkill(noFm, true, false)).toBe(noFm);
  });

  it('appends `skills: [base]` when base exists and no skills line is present', () => {
    const out = maybeInjectBaseSkill(sampleAgent, true, false);
    expect(out).toContain('skills: [base]');
    // Frontmatter still well-formed
    expect(out).toMatch(/^---\nname: my-agent\nmodel: sonnet\nskills: \[base\]\n---/);
    // Body preserved
    expect(out).toContain('Body of the agent.');
  });

  it('does NOT overwrite an existing skills line without --reset', () => {
    const withSkills = '---\nname: my-agent\nskills: [custom]\n---\n\nBody.\n';
    expect(maybeInjectBaseSkill(withSkills, true, false)).toBe(withSkills);
  });

  it('overwrites an existing skills line when --reset is set', () => {
    const withSkills = '---\nname: my-agent\nskills: [custom]\n---\n\nBody.\n';
    const out = maybeInjectBaseSkill(withSkills, true, true);
    expect(out).toContain('skills: [base]');
    expect(out).not.toContain('skills: [custom]');
  });

  it('preserves all other frontmatter fields exactly', () => {
    const multi = '---\nname: x\ndescription: A description\nmodel: opus\ncolor: green\n---\n\nbody\n';
    const out = maybeInjectBaseSkill(multi, true, false);
    expect(out).toContain('name: x');
    expect(out).toContain('description: A description');
    expect(out).toContain('model: opus');
    expect(out).toContain('color: green');
    expect(out).toContain('skills: [base]');
  });
});
