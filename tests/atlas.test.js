import { describe, it, expect } from 'vitest';
import { generateAtlas } from '../src/lib/atlas.js';

// ---------------------------------------------------------------------------
// Helper: build a realistic 6-file serialized graph (matches serializeGraph output)
// ---------------------------------------------------------------------------
function makeGraph(overrides = {}) {
  return {
    version: '1.0',
    meta: {
      generatedAt: '2026-04-14T12:00:00.000Z',
      gitHash: 'abc1234',
      totalFiles: 6,
      totalEdges: 5,
    },
    files: {
      'src/lib/runner.js': {
        imports: ['src/lib/utils.js'],
        importedBy: ['src/commands/doc-init.js', 'src/commands/doc-sync.js', 'src/commands/customize.js'],
        exports: ['runClaude', 'runCodex', 'parseFileOutput'],
        lines: 420,
        fanIn: 3,
        fanOut: 1,
        churn: 6,
        priority: 20.5,
        cluster: 'lib',
      },
      'src/lib/scanner.js': {
        imports: ['src/lib/utils.js'],
        importedBy: ['src/commands/doc-init.js', 'src/lib/runner.js'],
        exports: ['scanRepo', 'detectLanguages'],
        lines: 310,
        fanIn: 2,
        fanOut: 1,
        churn: 4,
        priority: 15.0,
        cluster: 'lib',
      },
      'src/lib/utils.js': {
        imports: [],
        importedBy: ['src/lib/runner.js', 'src/lib/scanner.js'],
        exports: ['formatPath', 'shortName'],
        lines: 80,
        fanIn: 2,
        fanOut: 0,
        churn: 1,
        priority: 5.0,
        cluster: 'lib',
      },
      'src/commands/doc-init.js': {
        imports: ['src/lib/runner.js', 'src/lib/scanner.js'],
        importedBy: [],
        exports: ['docInitCommand'],
        lines: 800,
        fanIn: 0,
        fanOut: 2,
        churn: 15,
        priority: 25.0,
        cluster: 'commands',
      },
      'src/commands/doc-sync.js': {
        imports: ['src/lib/runner.js'],
        importedBy: [],
        exports: ['docSyncCommand'],
        lines: 350,
        fanIn: 0,
        fanOut: 1,
        churn: 7,
        priority: 12.0,
        cluster: 'commands',
      },
      'src/commands/customize.js': {
        imports: ['src/lib/runner.js'],
        importedBy: [],
        exports: ['customizeCommand'],
        lines: 200,
        fanIn: 0,
        fanOut: 1,
        churn: 3,
        priority: 8.0,
        cluster: 'commands',
      },
    },
    hubs: [
      { path: 'src/lib/runner.js', fanIn: 3, exports: ['runClaude', 'runCodex', 'parseFileOutput'] },
      { path: 'src/lib/scanner.js', fanIn: 2, exports: ['scanRepo', 'detectLanguages'] },
    ],
    clusters: [
      { label: 'lib', size: 3, files: ['src/lib/runner.js', 'src/lib/scanner.js', 'src/lib/utils.js'] },
      { label: 'commands', size: 3, files: ['src/commands/doc-init.js', 'src/commands/doc-sync.js', 'src/commands/customize.js'] },
    ],
    coupling: [
      { from: 'commands', to: 'lib', edges: 4 },
    ],
    hotspots: [
      { path: 'src/commands/doc-init.js', churn: 15, lines: 800 },
      { path: 'src/commands/doc-sync.js', churn: 7, lines: 350 },
    ],
    clusterIndex: { lib: 0, commands: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateAtlas
// ---------------------------------------------------------------------------
describe('generateAtlas', () => {
  it('produces atlas with hub files section', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph);

    expect(atlas).toContain('## Project Atlas');
    expect(atlas).toContain('src/lib/runner.js');
    expect(atlas).toContain('3 dependents');
    expect(atlas).toContain('runClaude');
    expect(atlas).toContain('runCodex');
    expect(atlas).toContain('parseFileOutput');
    expect(atlas).toContain('src/lib/scanner.js');
    expect(atlas).toContain('2 dependents');
    expect(atlas).toContain('scanRepo');
  });

  it('includes domain clusters', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph);

    expect(atlas).toContain('**lib**');
    expect(atlas).toContain('**commands**');
  });

  it('includes hotspots', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph);

    expect(atlas).toContain('src/commands/doc-init.js');
    expect(atlas).toContain('15 changes');
    expect(atlas).toContain('800 lines');
  });

  it('includes graph stats footer', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph);

    expect(atlas).toContain('6 files');
    expect(atlas).toContain('5 edges');
  });

  it('stays under 600 tokens for a 6-file graph', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph);

    // Rough heuristic: ~4 chars per token => 600 tokens = 2400 chars
    expect(atlas.length).toBeLessThan(2400);
  });

  it('respects maxHubs option', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph, { maxHubs: 1 });

    // Should show runner (fanIn 3) but not scanner (fanIn 2)
    expect(atlas).toContain('src/lib/runner.js');
    expect(atlas).not.toContain('src/lib/scanner.js');
  });

  it('respects maxHotspots option', () => {
    const graph = makeGraph();
    const atlas = generateAtlas(graph, { maxHotspots: 1 });

    // Hotspots section should only have doc-init, not doc-sync
    const hotspotsSection = atlas.split('**Hotspots:**')[1]?.split('**')[0] ?? '';
    expect(hotspotsSection).toContain('doc-init.js');
    expect(hotspotsSection).not.toContain('doc-sync.js');
  });

  it('links skills to matching clusters', () => {
    const graph = makeGraph();
    const skills = [
      { name: 'lib', path: '.claude/skills/lib/skill.md', description: 'Library utilities' },
    ];
    const atlas = generateAtlas(graph, { skills });

    expect(atlas).toContain('[skill](.claude/skills/lib/skill.md)');
  });

  it('filters out single-file clusters', () => {
    const graph = makeGraph({
      clusters: [
        { label: 'lib', size: 3, files: ['src/lib/runner.js', 'src/lib/scanner.js', 'src/lib/utils.js'] },
        { label: 'commands', size: 3, files: ['src/commands/doc-init.js', 'src/commands/doc-sync.js', 'src/commands/customize.js'] },
        { label: 'tests', size: 1, files: ['tests/scanner.test.js'] },
      ],
      clusterIndex: { lib: 0, commands: 1, tests: 2 },
    });
    const atlas = generateAtlas(graph);

    expect(atlas).not.toContain('**tests**');
  });
});
