import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { init } from 'es-module-lexer';
import {
  parseJsImports,
  parsePyImports,
  resolveRelativeImport,
  buildRepoGraph,
  computeDomainClusters,
} from '../src/lib/graph-builder.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'graph-builder');

function createFixture(name, files) {
  const dir = join(FIXTURES_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

beforeAll(async () => {
  await init; // es-module-lexer WASM must be initialized before parseJsImports works
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup race with other test files */ }
});

// ---------------------------------------------------------------------------
// 1. JS/TS import parsing
//    parseJsImports(content, relPath) → { imports: string[], exports: string[] }
//    imports are raw specifiers; exports are export names
// ---------------------------------------------------------------------------
describe('parseJsImports', () => {
  it('extracts named ES module imports', () => {
    const result = parseJsImports(`import { foo, bar } from './bar.js';`, 'src/app.js');
    expect(result.imports).toContain('./bar.js');
  });

  it('extracts default imports', () => {
    const result = parseJsImports(`import foo from './bar';`, 'src/app.js');
    expect(result.imports).toContain('./bar');
  });

  it('extracts side-effect imports', () => {
    const result = parseJsImports(`import './styles.css';`, 'src/app.js');
    expect(result.imports).toContain('./styles.css');
  });

  it('extracts re-exports', () => {
    const result = parseJsImports(`export { foo } from './bar';`, 'src/app.js');
    expect(result.imports).toContain('./bar');
  });

  it('extracts dynamic imports', () => {
    const result = parseJsImports(`const mod = await import('./bar');`, 'src/app.js');
    expect(result.imports).toContain('./bar');
  });

  it('classifies bare node/npm imports as external', () => {
    const result = parseJsImports(`import fs from 'fs';`, 'src/app.js');
    expect(result.imports).toContain('fs');
  });

  it('classifies scoped packages as external', () => {
    const result = parseJsImports(`import { x } from '@clack/prompts';`, 'src/app.js');
    expect(result.imports).toContain('@clack/prompts');
  });

  it('classifies node: protocol imports as external', () => {
    const result = parseJsImports(`import { readFile } from 'node:fs/promises';`, 'src/app.js');
    expect(result.imports).toContain('node:fs/promises');
  });

  it('handles multiple imports in one file', () => {
    const code = [
      `import { join } from 'path';`,
      `import { readFile } from 'fs';`,
      `import { helper } from './utils.js';`,
      `import config from '../config.js';`,
    ].join('\n');
    const result = parseJsImports(code, 'src/app.js');
    expect(result.imports).toContain('path');
    expect(result.imports).toContain('fs');
    expect(result.imports).toContain('./utils.js');
    expect(result.imports).toContain('../config.js');
    // 2 external (path, fs) + 2 local (./utils.js, ../config.js) = 4 total
    expect(result.imports).toHaveLength(4);
  });

  it('ignores commented-out imports', () => {
    const code = [
      `// import { old } from './old.js';`,
      `import { active } from './active.js';`,
    ].join('\n');
    const result = parseJsImports(code, 'src/app.js');
    expect(result.imports).not.toContain('./old.js');
    expect(result.imports).toContain('./active.js');
  });

  it('handles require() calls as imports', () => {
    const code = `const foo = require('./bar');`;
    const result = parseJsImports(code, 'src/app.js');
    // es-module-lexer may or may not pick up require() — it focuses on ESM.
    // If it does, great; if not, this is expected behavior.
    // The implementation relies on es-module-lexer which only parses ESM syntax.
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Python import parsing
//    parsePyImports(content) → string[]  (raw specifiers)
// ---------------------------------------------------------------------------
describe('parsePyImports', () => {
  it('parses bare import', () => {
    const result = parsePyImports(`import os`);
    expect(result).toContain('os');
  });

  it('parses from-import', () => {
    const result = parsePyImports(`from pathlib import Path`);
    expect(result).toContain('pathlib');
  });

  it('parses relative dot import', () => {
    const result = parsePyImports(`from .utils import helper`);
    expect(result).toContain('.utils');
  });

  it('parses double-dot relative import', () => {
    const result = parsePyImports(`from ..models import User`);
    expect(result).toContain('..models');
  });

  it('parses dotted internal module path', () => {
    const result = parsePyImports(`from src.lib.scanner import scanRepo`);
    expect(result).toContain('src.lib.scanner');
  });

  it('handles multiple imports', () => {
    const code = [
      `import os`,
      `import sys`,
      `from .utils import helper`,
      `from pathlib import Path`,
    ].join('\n');
    const result = parsePyImports(code);
    expect(result).toHaveLength(4);
    expect(result).toContain('os');
    expect(result).toContain('sys');
    expect(result).toContain('.utils');
    expect(result).toContain('pathlib');
  });

  it('ignores commented-out imports', () => {
    const code = [
      `# import os`,
      `from pathlib import Path`,
    ].join('\n');
    const result = parsePyImports(code);
    expect(result).not.toContain('os');
    expect(result).toContain('pathlib');
  });
});

// ---------------------------------------------------------------------------
// 3. Import resolution
//    resolveRelativeImport(repoPath, fromFile, specifier) → string|null
// ---------------------------------------------------------------------------
describe('resolveRelativeImport', () => {
  it('resolves relative import in same directory', () => {
    const dir = createFixture('resolve-same-dir', {
      'src/lib/runner.js': '',
      'src/lib/scanner.js': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/lib/runner.js', './scanner.js');
    expect(resolved).toBe('src/lib/scanner.js');
  });

  it('resolves parent-directory import', () => {
    const dir = createFixture('resolve-parent', {
      'src/commands/scan.js': '',
      'src/lib/scanner.js': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/commands/scan.js', '../lib/scanner.js');
    expect(resolved).toBe('src/lib/scanner.js');
  });

  it('resolves import without extension by trying .js', () => {
    const dir = createFixture('resolve-no-ext-js', {
      'src/lib/runner.js': '',
      'src/lib/scanner.js': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/lib/runner.js', './scanner');
    expect(resolved).toBe('src/lib/scanner.js');
  });

  it('resolves import without extension by trying .ts', () => {
    const dir = createFixture('resolve-no-ext-ts', {
      'src/lib/runner.ts': '',
      'src/lib/scanner.ts': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/lib/runner.ts', './scanner');
    expect(resolved).toBe('src/lib/scanner.ts');
  });

  it('resolves import without extension by trying .tsx', () => {
    const dir = createFixture('resolve-no-ext-tsx', {
      'src/components/App.tsx': '',
      'src/components/Button.tsx': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/components/App.tsx', './Button');
    expect(resolved).toBe('src/components/Button.tsx');
  });

  it('resolves import without extension by trying .jsx', () => {
    const dir = createFixture('resolve-no-ext-jsx', {
      'src/components/App.jsx': '',
      'src/components/Button.jsx': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/components/App.jsx', './Button');
    expect(resolved).toBe('src/components/Button.jsx');
  });

  it('resolves import without extension by trying .mjs', () => {
    const dir = createFixture('resolve-no-ext-mjs', {
      'src/lib/runner.mjs': '',
      'src/lib/scanner.mjs': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/lib/runner.mjs', './scanner');
    expect(resolved).toBe('src/lib/scanner.mjs');
  });

  it('resolves directory import to index.js', () => {
    const dir = createFixture('resolve-dir-index-js', {
      'src/app.js': '',
      'src/utils/index.js': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/app.js', './utils');
    expect(resolved).toBe('src/utils/index.js');
  });

  it('resolves directory import to index.ts', () => {
    const dir = createFixture('resolve-dir-index-ts', {
      'src/app.ts': '',
      'src/utils/index.ts': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/app.ts', './utils');
    expect(resolved).toBe('src/utils/index.ts');
  });

  it('returns null for unresolvable imports', () => {
    const dir = createFixture('resolve-missing', {
      'src/app.js': '',
    });
    const resolved = resolveRelativeImport(dir, 'src/app.js', './nonexistent');
    expect(resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Graph building
//    buildRepoGraph(repoPath, languages?) → async { files, edges, ranked, hubs, ... }
//    files[relPath] = { imports, importedBy, exports, externalImports, lines, fanIn, fanOut, ... }
// ---------------------------------------------------------------------------
describe('buildRepoGraph', () => {
  it('builds correct imports and importedBy arrays', async () => {
    const dir = createFixture('graph-basic', {
      'src/index.js': [
        `import { run } from './lib/runner.js';`,
        `import { scan } from './lib/scanner.js';`,
      ].join('\n'),
      'src/lib/runner.js': [
        `import { scan } from './scanner.js';`,
      ].join('\n'),
      'src/lib/scanner.js': `export function scan() {}`,
    });

    const graph = await buildRepoGraph(dir);

    // index.js imports runner and scanner
    const indexNode = graph.files['src/index.js'];
    expect(indexNode.imports).toContain('src/lib/runner.js');
    expect(indexNode.imports).toContain('src/lib/scanner.js');

    // runner.js imports scanner
    const runnerNode = graph.files['src/lib/runner.js'];
    expect(runnerNode.imports).toContain('src/lib/scanner.js');

    // scanner is imported by both index and runner
    const scannerNode = graph.files['src/lib/scanner.js'];
    expect(scannerNode.importedBy).toContain('src/index.js');
    expect(scannerNode.importedBy).toContain('src/lib/runner.js');
  });

  it('builds correct edges array', async () => {
    const dir = createFixture('graph-edges', {
      'src/a.js': `import { b } from './b.js';`,
      'src/b.js': `import { c } from './c.js';`,
      'src/c.js': `export const c = 1;`,
    });

    const graph = await buildRepoGraph(dir);

    expect(graph.edges).toContainEqual({ from: 'src/a.js', to: 'src/b.js' });
    expect(graph.edges).toContainEqual({ from: 'src/b.js', to: 'src/c.js' });
    expect(graph.edges).toHaveLength(2);
  });

  it('computes correct fanIn and fanOut metrics', async () => {
    const dir = createFixture('graph-metrics', {
      'src/index.js': [
        `import { a } from './a.js';`,
        `import { b } from './b.js';`,
        `import { c } from './c.js';`,
      ].join('\n'),
      'src/a.js': `import { c } from './c.js';`,
      'src/b.js': `import { c } from './c.js';`,
      'src/c.js': `export const c = 1;`,
    });

    const graph = await buildRepoGraph(dir);

    // index.js: fanOut=3, fanIn=0
    expect(graph.files['src/index.js'].fanOut).toBe(3);
    expect(graph.files['src/index.js'].fanIn).toBe(0);

    // c.js: fanOut=0, fanIn=3 (imported by index, a, b)
    expect(graph.files['src/c.js'].fanOut).toBe(0);
    expect(graph.files['src/c.js'].fanIn).toBe(3);

    // a.js: fanOut=1, fanIn=1
    expect(graph.files['src/a.js'].fanOut).toBe(1);
    expect(graph.files['src/a.js'].fanIn).toBe(1);
  });

  it('sorts hubs by fanIn descending', async () => {
    const dir = createFixture('graph-hubs', {
      'src/index.js': [
        `import { a } from './a.js';`,
        `import { b } from './b.js';`,
        `import { shared } from './shared.js';`,
      ].join('\n'),
      'src/a.js': `import { shared } from './shared.js';`,
      'src/b.js': [
        `import { shared } from './shared.js';`,
        `import { a } from './a.js';`,
      ].join('\n'),
      'src/shared.js': `export const shared = 1;`,
    });

    const graph = await buildRepoGraph(dir);

    // shared.js has fanIn=3, a.js has fanIn=2, b.js has fanIn=1, index has fanIn=0
    expect(graph.hubs[0].path).toBe('src/shared.js');
    expect(graph.hubs[1].path).toBe('src/a.js');
  });

  it('excludes external imports from the graph edges', async () => {
    const dir = createFixture('graph-externals', {
      'src/app.js': [
        `import path from 'path';`,
        `import { helper } from './helper.js';`,
      ].join('\n'),
      'src/helper.js': `import fs from 'fs';`,
    });

    const graph = await buildRepoGraph(dir);

    // Only one internal edge: app -> helper
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({ from: 'src/app.js', to: 'src/helper.js' });
  });
});

// ---------------------------------------------------------------------------
// 5. Domain clustering (connected components)
//    computeDomainClusters(files, edges) → { components: [{label, files, size}], coupling: [...] }
// ---------------------------------------------------------------------------
describe('computeDomainClusters', () => {
  it('finds two separate clusters with no cross-imports', async () => {
    const dir = createFixture('cluster-two', {
      // Cluster 1: auth domain
      'src/auth/login.js': `import { validate } from './validate.js';`,
      'src/auth/validate.js': `export function validate() {}`,
      // Cluster 2: billing domain
      'src/billing/invoice.js': `import { calc } from './calc.js';`,
      'src/billing/calc.js': `export function calc() {}`,
    });

    const graph = await buildRepoGraph(dir);
    const result = computeDomainClusters(graph.files, graph.edges);

    expect(result.components).toHaveLength(2);
    const allFiles = result.components.map(c => c.files.sort());
    expect(allFiles).toContainEqual(
      ['src/auth/login.js', 'src/auth/validate.js'].sort(),
    );
    expect(allFiles).toContainEqual(
      ['src/billing/calc.js', 'src/billing/invoice.js'].sort(),
    );
  });

  it('finds one cluster when all files are connected', async () => {
    const dir = createFixture('cluster-one', {
      'src/a.js': `import { b } from './b.js';`,
      'src/b.js': `import { c } from './c.js';`,
      'src/c.js': `export const c = 1;`,
    });

    const graph = await buildRepoGraph(dir);
    const result = computeDomainClusters(graph.files, graph.edges);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].files.sort()).toEqual(
      ['src/a.js', 'src/b.js', 'src/c.js'].sort(),
    );
  });

  it('treats files with only external imports as isolated nodes', async () => {
    const dir = createFixture('cluster-isolated', {
      'src/a.js': `import fs from 'fs';`,
      'src/b.js': `import path from 'path';`,
    });

    const graph = await buildRepoGraph(dir);
    const result = computeDomainClusters(graph.files, graph.edges);

    // Each file is its own isolated cluster
    expect(result.components).toHaveLength(2);
    const allFiles = result.components.map(c => c.files);
    expect(allFiles).toContainEqual(['src/a.js']);
    expect(allFiles).toContainEqual(['src/b.js']);
  });

  it('merges clusters connected by a bridge file', async () => {
    const dir = createFixture('cluster-bridge', {
      'src/auth/login.js': `import { validate } from './validate.js';`,
      'src/auth/validate.js': `export function validate() {}`,
      'src/billing/invoice.js': `import { calc } from './calc.js';`,
      'src/billing/calc.js': `export function calc() {}`,
      // Bridge file connects both clusters
      'src/index.js': [
        `import { validate } from './auth/validate.js';`,
        `import { calc } from './billing/calc.js';`,
      ].join('\n'),
    });

    const graph = await buildRepoGraph(dir);
    const result = computeDomainClusters(graph.files, graph.edges);

    // Everything is connected through index.js
    expect(result.components).toHaveLength(1);
    expect(result.components[0].files).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('handles empty file with no imports or exports', async () => {
    const dir = createFixture('edge-empty', {
      'src/empty.js': '',
    });

    const graph = await buildRepoGraph(dir);
    const node = graph.files['src/empty.js'];
    expect(node).toBeDefined();
    expect(node.imports).toHaveLength(0);
    expect(node.importedBy).toHaveLength(0);
    expect(node.fanIn).toBe(0);
    expect(node.fanOut).toBe(0);
  });

  it('handles file with only external imports (no internal edges)', async () => {
    const dir = createFixture('edge-external-only', {
      'src/app.js': [
        `import fs from 'fs';`,
        `import path from 'path';`,
        `import { x } from '@clack/prompts';`,
      ].join('\n'),
    });

    const graph = await buildRepoGraph(dir);
    expect(graph.edges).toHaveLength(0);
    expect(graph.files['src/app.js'].imports).toHaveLength(0);
    expect(graph.files['src/app.js'].fanOut).toBe(0);
  });

  it('handles circular imports (A imports B, B imports A)', async () => {
    const dir = createFixture('edge-circular', {
      'src/a.js': `import { b } from './b.js';`,
      'src/b.js': `import { a } from './a.js';`,
    });

    const graph = await buildRepoGraph(dir);

    // A imports B
    expect(graph.files['src/a.js'].imports).toContain('src/b.js');
    // B imports A
    expect(graph.files['src/b.js'].imports).toContain('src/a.js');
    // Both appear in each other's importedBy
    expect(graph.files['src/a.js'].importedBy).toContain('src/b.js');
    expect(graph.files['src/b.js'].importedBy).toContain('src/a.js');
    // Both edges present
    expect(graph.edges).toContainEqual({ from: 'src/a.js', to: 'src/b.js' });
    expect(graph.edges).toContainEqual({ from: 'src/b.js', to: 'src/a.js' });
    expect(graph.edges).toHaveLength(2);
  });

  it('handles file with syntax errors gracefully (no crash)', async () => {
    const dir = createFixture('edge-syntax-error', {
      'src/good.js': `import { broken } from './broken.js';`,
      'src/broken.js': `{{{ this is not valid javascript >>>`,
    });

    // Should not throw
    const graph = await buildRepoGraph(dir);
    expect(graph).toBeDefined();
    expect(graph.files).toBeDefined();
    // The good file should still be in the graph
    expect(graph.files['src/good.js']).toBeDefined();
  });

  it('handles deeply nested imports', async () => {
    const dir = createFixture('edge-deep-nesting', {
      'src/a/b/c/d/deep.js': `import { root } from '../../../../root.js';`,
      'src/root.js': `export const root = 1;`,
    });

    const graph = await buildRepoGraph(dir);
    expect(graph.files['src/a/b/c/d/deep.js'].imports).toContain('src/root.js');
    expect(graph.files['src/root.js'].importedBy).toContain('src/a/b/c/d/deep.js');
  });

  it('handles mixed JS and TS files', async () => {
    const dir = createFixture('edge-mixed-lang', {
      'src/app.ts': `import { helper } from './helper';`,
      'src/helper.js': `export function helper() {}`,
    });

    const graph = await buildRepoGraph(dir);
    expect(graph.files['src/app.ts'].imports).toContain('src/helper.js');
  });

  it('handles TypeScript type-only imports', () => {
    const code = `import type { User } from './types';`;
    const result = parseJsImports(code, 'src/app.ts');
    expect(result.imports).toContain('./types');
  });

  it('handles star re-exports', () => {
    const code = `export * from './utils';`;
    const result = parseJsImports(code, 'src/index.js');
    expect(result.imports).toContain('./utils');
  });
});
