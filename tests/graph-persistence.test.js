import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  serializeGraph,
  saveGraph,
  loadGraph,
  extractFileReferences,
  extractSubgraph,
  formatNavigationContext,
  generateCodeMap,
  writeCodeMap,
  generateGraphIndex,
  saveGraphIndex,
  persistGraphArtifacts,
} from '../src/lib/graph-persistence.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'graph-persistence');

beforeAll(() => {
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup race */ }
});

// ---------------------------------------------------------------------------
// Helper: build a minimal raw graph (as buildRepoGraph would return)
// ---------------------------------------------------------------------------
function makeRawGraph(overrides = {}) {
  const files = {
    'src/lib/scanner.js': {
      imports: ['src/lib/utils.js'],
      importedBy: ['src/commands/scan.js', 'src/commands/doc-init.js', 'src/lib/graph-builder.js'],
      exports: ['scanRepo', 'detectEntryPoints'],
      externalImports: ['fs', 'path'],
      lines: 350,
      fanIn: 3,
      fanOut: 1,
      exportCount: 2,
      churn: 8,
      priority: 22.5,
    },
    'src/lib/utils.js': {
      imports: [],
      importedBy: ['src/lib/scanner.js'],
      exports: ['formatPath'],
      externalImports: ['path'],
      lines: 50,
      fanIn: 1,
      fanOut: 0,
      exportCount: 1,
      churn: 2,
      priority: 5.0,
    },
    'src/lib/graph-builder.js': {
      imports: ['src/lib/scanner.js'],
      importedBy: ['src/commands/doc-init.js'],
      exports: ['buildRepoGraph'],
      externalImports: ['es-module-lexer'],
      lines: 690,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 5,
      priority: 15.0,
    },
    'src/commands/scan.js': {
      imports: ['src/lib/scanner.js'],
      importedBy: [],
      exports: ['scanCommand'],
      externalImports: ['commander'],
      lines: 120,
      fanIn: 0,
      fanOut: 1,
      exportCount: 1,
      churn: 3,
      priority: 8.0,
    },
    'src/commands/doc-init.js': {
      imports: ['src/lib/scanner.js', 'src/lib/graph-builder.js'],
      importedBy: [],
      exports: ['docInitCommand'],
      externalImports: ['commander', 'picocolors'],
      lines: 891,
      fanIn: 0,
      fanOut: 2,
      exportCount: 1,
      churn: 10,
      priority: 25.0,
    },
    'tests/scanner.test.js': {
      imports: [],
      importedBy: [],
      exports: [],
      externalImports: ['vitest'],
      lines: 200,
      fanIn: 0,
      fanOut: 0,
      exportCount: 0,
      churn: 4,
      priority: 9.0,
    },
  };

  return {
    files,
    edges: [
      { from: 'src/lib/scanner.js', to: 'src/lib/utils.js' },
      { from: 'src/commands/scan.js', to: 'src/lib/scanner.js' },
      { from: 'src/commands/doc-init.js', to: 'src/lib/scanner.js' },
      { from: 'src/commands/doc-init.js', to: 'src/lib/graph-builder.js' },
      { from: 'src/lib/graph-builder.js', to: 'src/lib/scanner.js' },
    ],
    ranked: Object.entries(files)
      .map(([path, info]) => ({ path, ...info }))
      .sort((a, b) => b.priority - a.priority),
    hubs: [
      { path: 'src/lib/scanner.js', fanIn: 3, fanOut: 1, exports: ['scanRepo', 'detectEntryPoints'] },
      { path: 'src/lib/graph-builder.js', fanIn: 1, fanOut: 1, exports: ['buildRepoGraph'] },
    ],
    clusters: {
      components: [
        { label: 'src', files: ['src/lib/scanner.js', 'src/lib/utils.js', 'src/lib/graph-builder.js', 'src/commands/scan.js', 'src/commands/doc-init.js'], size: 5 },
        { label: 'tests', files: ['tests/scanner.test.js'], size: 1 },
      ],
      coupling: [
        { from: 'src', to: 'tests', edges: 0 },
      ],
    },
    hotspots: [
      { path: 'src/commands/doc-init.js', churn: 10, lines: 891 },
      { path: 'src/lib/scanner.js', churn: 8, lines: 350 },
    ],
    entryPoints: ['src/commands/scan.js'],
    stats: {
      totalFiles: 6,
      totalEdges: 5,
      totalExternalImports: 6,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// serializeGraph
// ---------------------------------------------------------------------------
describe('serializeGraph', () => {
  it('produces correct version and meta', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    expect(serialized.version).toBe('1.0');
    expect(serialized.meta.totalFiles).toBe(6);
    expect(serialized.meta.totalEdges).toBe(5);
    expect(serialized.meta.generatedAt).toBeTruthy();
  });

  it('adds cluster field to each file', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    expect(serialized.files['src/lib/scanner.js'].cluster).toBe('src');
    expect(serialized.files['tests/scanner.test.js'].cluster).toBe('tests');
  });

  it('builds clusterIndex for O(1) lookup', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    expect(serialized.clusterIndex).toHaveProperty('src');
    expect(serialized.clusterIndex).toHaveProperty('tests');
    expect(serialized.clusters[serialized.clusterIndex.src].label).toBe('src');
  });

  it('preserves hubs and hotspots', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    expect(serialized.hubs).toHaveLength(2);
    expect(serialized.hubs[0].path).toBe('src/lib/scanner.js');
    expect(serialized.hotspots).toHaveLength(2);
  });

  it('drops externalImports from files', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    expect(serialized.files['src/lib/scanner.js']).not.toHaveProperty('externalImports');
  });

  it('rounds priority to 1 decimal place', () => {
    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, FIXTURES_DIR);

    for (const info of Object.values(serialized.files)) {
      const str = String(info.priority);
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// saveGraph / loadGraph — round-trip
// ---------------------------------------------------------------------------
describe('saveGraph / loadGraph', () => {
  it('round-trips correctly', () => {
    const dir = join(FIXTURES_DIR, 'roundtrip');
    mkdirSync(dir, { recursive: true });

    const raw = makeRawGraph();
    const serialized = serializeGraph(raw, dir);
    saveGraph(dir, serialized);

    const loaded = loadGraph(dir);
    expect(loaded).toEqual(serialized);
  });

  it('returns null for missing file', () => {
    const result = loadGraph(join(FIXTURES_DIR, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const dir = join(FIXTURES_DIR, 'invalid-json');
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'graph.json'), '{ invalid json }}}');

    const result = loadGraph(dir);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFileReferences
// ---------------------------------------------------------------------------
describe('extractFileReferences', () => {
  const graph = serializeGraph(makeRawGraph(), FIXTURES_DIR);

  it('matches explicit paths', () => {
    const refs = extractFileReferences('look at src/lib/scanner.js please', graph);
    expect(refs).toContain('src/lib/scanner.js');
  });

  it('matches bare filenames', () => {
    const refs = extractFileReferences('the scanner.js file has a bug', graph);
    expect(refs).toContain('src/lib/scanner.js');
  });

  it('does not match non-existent files', () => {
    const refs = extractFileReferences('check nonexistent.js for issues', graph);
    expect(refs).toHaveLength(0);
  });

  it('matches multiple files', () => {
    const refs = extractFileReferences('compare scanner.js and graph-builder.js', graph);
    expect(refs).toContain('src/lib/scanner.js');
    expect(refs).toContain('src/lib/graph-builder.js');
  });

  it('falls back to cluster keywords when no files match', () => {
    const refs = extractFileReferences('how does the tests module work', graph);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some(r => r.startsWith('tests/'))).toBe(true);
  });

  it('deduplicates results', () => {
    // Both explicit path and bare name should only appear once
    const refs = extractFileReferences('fix src/lib/scanner.js (scanner.js)', graph);
    const unique = new Set(refs);
    expect(refs.length).toBe(unique.size);
  });
});

// ---------------------------------------------------------------------------
// extractSubgraph
// ---------------------------------------------------------------------------
describe('extractSubgraph', () => {
  const graph = serializeGraph(makeRawGraph(), FIXTURES_DIR);

  it('returns empty for no files', () => {
    const sub = extractSubgraph(graph, []);
    expect(sub.mentionedFiles).toHaveLength(0);
  });

  it('includes mentioned files with full info', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    expect(sub.mentionedFiles).toHaveLength(1);
    expect(sub.mentionedFiles[0].path).toBe('src/lib/scanner.js');
    expect(sub.mentionedFiles[0].fanIn).toBe(3);
  });

  it('includes 1-hop neighbors', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    const neighborPaths = sub.neighbors.map(n => n.path);
    // scanner imports utils and is imported by scan.js, doc-init.js, graph-builder.js
    expect(neighborPaths).toContain('src/lib/utils.js');
    expect(neighborPaths.length).toBeGreaterThan(0);
  });

  it('includes relevant hubs', () => {
    const sub = extractSubgraph(graph, ['src/commands/scan.js']);
    // scan.js is in the 'src' cluster, scanner.js is a hub in that cluster
    expect(sub.hubs.length).toBeGreaterThan(0);
  });

  it('includes cluster context', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    expect(sub.clusters.length).toBeGreaterThan(0);
    expect(sub.clusters[0].label).toBe('src');
  });

  it('handles missing files gracefully', () => {
    const sub = extractSubgraph(graph, ['nonexistent/file.js']);
    expect(sub.mentionedFiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatNavigationContext
// ---------------------------------------------------------------------------
describe('formatNavigationContext', () => {
  const graph = serializeGraph(makeRawGraph(), FIXTURES_DIR);

  it('returns empty string for empty subgraph', () => {
    const sub = extractSubgraph(graph, []);
    expect(formatNavigationContext(sub)).toBe('');
  });

  it('returns markdown with referenced files section', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    const md = formatNavigationContext(sub);
    expect(md).toContain('## Code Navigation');
    expect(md).toContain('**Referenced files:**');
    expect(md).toContain('src/lib/scanner.js');
  });

  it('shows hub tag for high-fanIn files', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    const md = formatNavigationContext(sub);
    expect(md).toContain('hub: 3 dependents');
  });

  it('shows cluster info', () => {
    const sub = extractSubgraph(graph, ['src/lib/scanner.js']);
    const md = formatNavigationContext(sub);
    expect(md).toContain('**Cluster:**');
    expect(md).toContain('src');
  });

  it('stays within line budget', () => {
    const sub = extractSubgraph(graph, Object.keys(graph.files));
    const md = formatNavigationContext(sub);
    const lineCount = md.split('\n').length;
    expect(lineCount).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// generateCodeMap
// ---------------------------------------------------------------------------
describe('generateCodeMap', () => {
  const graph = serializeGraph(makeRawGraph(), FIXTURES_DIR);

  it('produces codebase structure header', () => {
    const map = generateCodeMap(graph);
    expect(map).toContain('## Codebase Structure');
  });

  it('includes hub files', () => {
    const map = generateCodeMap(graph);
    expect(map).toContain('Hub files');
    expect(map).toContain('src/lib/scanner.js');
  });

  it('includes hotspots', () => {
    const map = generateCodeMap(graph);
    expect(map).toContain('Hotspots');
  });

  it('includes graph stats', () => {
    const map = generateCodeMap(graph);
    expect(map).toContain('6 files');
    expect(map).toContain('5 edges');
  });
});

// ---------------------------------------------------------------------------
// writeCodeMap
// ---------------------------------------------------------------------------
describe('writeCodeMap', () => {
  it('writes code-map.md to .claude/', () => {
    const dir = join(FIXTURES_DIR, 'code-map-write');
    mkdirSync(dir, { recursive: true });

    const graph = serializeGraph(makeRawGraph(), dir);
    writeCodeMap(dir, graph);

    const mapPath = join(dir, '.claude', 'code-map.md');
    expect(existsSync(mapPath)).toBe(true);

    const content = readFileSync(mapPath, 'utf-8');
    expect(content).toContain('## Codebase Structure');
  });
});

// ---------------------------------------------------------------------------
// generateGraphIndex
// ---------------------------------------------------------------------------
describe('generateGraphIndex', () => {
  const graph = serializeGraph(makeRawGraph(), FIXTURES_DIR);

  it('builds export name index', () => {
    const index = generateGraphIndex(graph);
    expect(index.exports.scanRepo).toBe('src/lib/scanner.js');
    expect(index.exports.buildRepoGraph).toBe('src/lib/graph-builder.js');
  });

  it('builds hub basenames index', () => {
    const index = generateGraphIndex(graph);
    expect(index.hubBasenames['scanner.js']).toBe('src/lib/scanner.js');
  });

  it('includes cluster labels', () => {
    const index = generateGraphIndex(graph);
    expect(index.clusterLabels).toContain('src');
    expect(index.clusterLabels).toContain('tests');
  });

  it('skips very short export names', () => {
    const index = generateGraphIndex(graph);
    // All exports in our fixture are > 2 chars, so nothing should be skipped
    // But if we had a 2-char export, it should be excluded
    for (const key of Object.keys(index.exports)) {
      expect(key.length).toBeGreaterThan(2);
    }
  });
});

// ---------------------------------------------------------------------------
// saveGraphIndex / round-trip
// ---------------------------------------------------------------------------
describe('saveGraphIndex', () => {
  it('writes and is loadable', () => {
    const dir = join(FIXTURES_DIR, 'index-write');
    mkdirSync(dir, { recursive: true });

    const graph = serializeGraph(makeRawGraph(), dir);
    const index = generateGraphIndex(graph);
    saveGraphIndex(dir, index);

    const indexPath = join(dir, '.claude', 'graph-index.json');
    expect(existsSync(indexPath)).toBe(true);

    const loaded = JSON.parse(readFileSync(indexPath, 'utf-8'));
    expect(loaded.exports.scanRepo).toBe('src/lib/scanner.js');
    expect(loaded.hubBasenames).toBeDefined();
    expect(loaded.clusterLabels).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// persistGraphArtifacts
// ---------------------------------------------------------------------------
describe('persistGraphArtifacts', () => {
  it('writes graph.json, code-map.md, and index in one call', () => {
    const dir = join(FIXTURES_DIR, 'persist-all');
    mkdirSync(dir, { recursive: true });

    const raw = makeRawGraph();
    persistGraphArtifacts(dir, raw);

    expect(existsSync(join(dir, '.claude', 'graph.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'graph-index.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'code-map.md'))).toBe(true);
  });
});
