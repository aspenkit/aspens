import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateAtlas } from '../src/lib/atlas.js';
import { serializeGraph } from '../src/lib/graph-persistence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'atlas-integration');

beforeAll(() => {
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(FIXTURES_DIR)) rmSync(FIXTURES_DIR, { recursive: true, force: true });
  } catch { /* ignore cleanup race */ }
});

// ---------------------------------------------------------------------------
// Helper: build a realistic raw graph (Express-like web app with auth, db,
// routes, middleware, tests) — matches buildRepoGraph() output shape.
// ---------------------------------------------------------------------------
function makeRealisticRawGraph() {
  const files = {
    'src/lib/auth.js': {
      imports: ['src/lib/db.js'],
      importedBy: ['src/routes/login.js', 'src/routes/signup.js', 'src/middleware/session.js'],
      exports: ['authenticate', 'hashPassword', 'verifyToken'],
      externalImports: ['bcrypt', 'jsonwebtoken'],
      lines: 180,
      fanIn: 3,
      fanOut: 1,
      exportCount: 3,
      churn: 8,
      priority: 24.0,
    },
    'src/lib/db.js': {
      imports: [],
      importedBy: ['src/lib/auth.js', 'src/routes/users.js', 'src/routes/products.js'],
      exports: ['query', 'transaction', 'pool'],
      externalImports: ['pg'],
      lines: 120,
      fanIn: 3,
      fanOut: 0,
      exportCount: 3,
      churn: 3,
      priority: 18.0,
    },
    'src/routes/login.js': {
      imports: ['src/lib/auth.js'],
      importedBy: ['src/app.js'],
      exports: ['loginRouter'],
      externalImports: ['express'],
      lines: 60,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 2,
      priority: 7.0,
    },
    'src/routes/signup.js': {
      imports: ['src/lib/auth.js'],
      importedBy: ['src/app.js'],
      exports: ['signupRouter'],
      externalImports: ['express'],
      lines: 55,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 2,
      priority: 7.0,
    },
    'src/routes/users.js': {
      imports: ['src/lib/db.js'],
      importedBy: ['src/app.js'],
      exports: ['usersRouter'],
      externalImports: ['express'],
      lines: 80,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 4,
      priority: 9.0,
    },
    'src/routes/products.js': {
      imports: ['src/lib/db.js'],
      importedBy: ['src/app.js'],
      exports: ['productsRouter'],
      externalImports: ['express'],
      lines: 90,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 3,
      priority: 8.0,
    },
    'src/middleware/session.js': {
      imports: ['src/lib/auth.js'],
      importedBy: ['src/app.js'],
      exports: ['sessionMiddleware'],
      externalImports: ['express'],
      lines: 40,
      fanIn: 1,
      fanOut: 1,
      exportCount: 1,
      churn: 2,
      priority: 6.0,
    },
    'src/app.js': {
      imports: [
        'src/routes/login.js',
        'src/routes/signup.js',
        'src/routes/users.js',
        'src/routes/products.js',
        'src/middleware/session.js',
      ],
      importedBy: [],
      exports: ['app'],
      externalImports: ['express'],
      lines: 70,
      fanIn: 0,
      fanOut: 5,
      exportCount: 1,
      churn: 5,
      priority: 14.0,
    },
    'tests/auth.test.js': {
      imports: ['src/lib/auth.js'],
      importedBy: [],
      exports: [],
      externalImports: ['vitest'],
      lines: 100,
      fanIn: 0,
      fanOut: 1,
      exportCount: 0,
      churn: 3,
      priority: 6.0,
    },
    'tests/db.test.js': {
      imports: ['src/lib/db.js'],
      importedBy: [],
      exports: [],
      externalImports: ['vitest'],
      lines: 80,
      fanIn: 0,
      fanOut: 1,
      exportCount: 0,
      churn: 2,
      priority: 5.0,
    },
  };

  return {
    files,
    edges: [
      { from: 'src/lib/auth.js', to: 'src/lib/db.js' },
      { from: 'src/routes/login.js', to: 'src/lib/auth.js' },
      { from: 'src/routes/signup.js', to: 'src/lib/auth.js' },
      { from: 'src/routes/users.js', to: 'src/lib/db.js' },
      { from: 'src/routes/products.js', to: 'src/lib/db.js' },
      { from: 'src/middleware/session.js', to: 'src/lib/auth.js' },
      { from: 'src/app.js', to: 'src/routes/login.js' },
      { from: 'src/app.js', to: 'src/routes/signup.js' },
      { from: 'src/app.js', to: 'src/routes/users.js' },
      { from: 'src/app.js', to: 'src/routes/products.js' },
      { from: 'src/app.js', to: 'src/middleware/session.js' },
      { from: 'tests/auth.test.js', to: 'src/lib/auth.js' },
      { from: 'tests/db.test.js', to: 'src/lib/db.js' },
    ],
    ranked: Object.entries(files)
      .map(([path, info]) => ({ path, ...info }))
      .sort((a, b) => b.priority - a.priority),
    hubs: [
      { path: 'src/lib/auth.js', fanIn: 3, fanOut: 1, exports: ['authenticate', 'hashPassword', 'verifyToken'] },
      { path: 'src/lib/db.js', fanIn: 3, fanOut: 0, exports: ['query', 'transaction', 'pool'] },
    ],
    clusters: {
      components: [
        {
          label: 'auth',
          size: 4,
          files: ['src/lib/auth.js', 'src/routes/login.js', 'src/routes/signup.js', 'src/middleware/session.js'],
        },
        {
          label: 'data',
          size: 3,
          files: ['src/lib/db.js', 'src/routes/users.js', 'src/routes/products.js'],
        },
        {
          label: 'app',
          size: 1,
          files: ['src/app.js'],
        },
        {
          label: 'tests',
          size: 2,
          files: ['tests/auth.test.js', 'tests/db.test.js'],
        },
      ],
      coupling: [
        { from: 'auth', to: 'data', edges: 1 },
        { from: 'app', to: 'auth', edges: 3 },
        { from: 'app', to: 'data', edges: 2 },
        { from: 'tests', to: 'auth', edges: 1 },
        { from: 'tests', to: 'data', edges: 1 },
      ],
    },
    hotspots: [
      { path: 'src/lib/auth.js', churn: 8, lines: 180 },
      { path: 'src/app.js', churn: 5, lines: 70 },
      { path: 'src/routes/users.js', churn: 4, lines: 80 },
    ],
    entryPoints: ['src/app.js'],
    stats: {
      totalFiles: 10,
      totalEdges: 13,
      totalExternalImports: 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('atlas-integration', () => {
  it('produces a compact atlas from a realistic graph', () => {
    const raw = makeRealisticRawGraph();
    const graph = serializeGraph(raw, FIXTURES_DIR);
    const atlas = generateAtlas(graph);

    // Contains the standard header
    expect(atlas).toContain('## Project Atlas');

    // Key hub files are present
    expect(atlas).toContain('src/lib/db.js');
    expect(atlas).toContain('src/lib/auth.js');

    // Their exports appear
    expect(atlas).toContain('query');
    expect(atlas).toContain('authenticate');

    // Stays under ~800 tokens (~3200 chars) for 10 files
    expect(atlas.length).toBeLessThan(3200);
  });

  it('links skills when provided', () => {
    const raw = makeRealisticRawGraph();
    const graph = serializeGraph(raw, FIXTURES_DIR);

    const skills = [
      { name: 'auth', path: '.claude/skills/auth.md', description: 'Authentication domain' },
    ];

    const atlas = generateAtlas(graph, { skills });

    // The auth cluster gets a skill link
    expect(atlas).toContain('[skill](.claude/skills/auth.md)');

    // The data cluster does NOT get a link (no matching skill provided)
    const dataLine = atlas.split('\n').find(l => l.includes('**data**'));
    expect(dataLine).toBeDefined();
    expect(dataLine).not.toContain('[skill]');
  });
});
