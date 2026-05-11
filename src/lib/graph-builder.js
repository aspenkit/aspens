import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { detectEntryPoints, scanRepo } from './scanner.js';
import { LOCK_FILES } from './diff-classifier.js';
import { parseJsImports } from './parsers/typescript.js';
import { parsePyImports, extractPythonExports } from './parsers/python.js';
import { detectNextjsEntryPoints, isNextjsProject, nextjsImplicitAliases } from './frameworks/nextjs.js';
import { loadPathAliases, resolveAliasImport } from './path-resolver.js';

/**
 * Build the import graph for a repository.
 * Returns adjacency list, edges, file metrics, hub files, and domain clusters.
 */
export async function buildRepoGraph(repoPath, languages = []) {
  // (es-module-lexer init lives in parsers/typescript.js — Phase 3 split)

  const baseEntryPoints = detectEntryPoints(repoPath);

  // Framework-aware entry points (Next.js implicit roots — Q4)
  const scan = safeScanForFrameworks(repoPath);
  const frameworkEntries = isNextjsProject(scan) ? detectNextjsEntryPoints(repoPath) : [];

  const entryPoints = dedupeStrings([...baseEntryPoints, ...frameworkEntries.map(e => e.path)]);
  const entryPointSet = new Set(entryPoints);
  const frameworkEntryByPath = new Map(frameworkEntries.map(e => [e.path, e.kind]));

  // Load path aliases from tsconfig.json (handles `extends` chains).
  // If no explicit paths and Next.js detected, fall back to the implicit `@/*` alias.
  let pathAliases = loadPathAliases(repoPath);
  if (pathAliases.length === 0 && isNextjsProject(scan)) {
    pathAliases = nextjsImplicitAliases(repoPath);
  }

  // Detect Python package roots (directories containing pyproject.toml, setup.py, or __init__.py at top level)
  const pythonRoots = detectPythonRoots(repoPath);

  // 1. Walk all source files
  const filePaths = walkSourceFiles(repoPath);

  // 2. Parse each file for imports and exports
  const files = {};
  const edges = [];

  for (const absPath of filePaths) {
    const relPath = relative(repoPath, absPath);
    const content = readFileSafe(absPath);
    if (content === null) continue;

    // Skip generated files (check first line for markers)
    if (isVendoredOrGenerated(basename(absPath), content)) continue;

    const lines = content.split('\n').length;
    const ext = extname(absPath);

    let rawImports = [];
    let exportNames = [];

    if (JS_EXTS.has(ext)) {
      const parsed = await parseJsImports(content, relPath);
      rawImports = parsed.imports;
      exportNames = parsed.exports;
    } else if (ext === '.py') {
      rawImports = parsePyImports(content);
      exportNames = extractPythonExports(content);
    }

    // Resolve imports
    const internalImports = [];
    const externalImports = [];

    for (const specifier of rawImports) {
      if (isRelativeImport(specifier) && JS_EXTS.has(ext)) {
        const resolved = resolveRelativeImport(repoPath, relPath, specifier);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (JS_EXTS.has(ext) && pathAliases.length > 0) {
        // Try resolving path aliases (@/components/..., ~/utils, etc.)
        const resolved = resolveAliasImport(repoPath, specifier, pathAliases);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.py' && isPythonRelativeImport(specifier)) {
        const resolved = resolvePythonRelativeImport(repoPath, relPath, specifier);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.py') {
        // Try resolving absolute Python imports from multiple roots
        const resolved = resolvePythonAbsoluteImport(repoPath, specifier, pythonRoots);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else {
        externalImports.push(specifier);
      }
    }

    files[relPath] = {
      imports: internalImports,
      importedBy: [],  // populated in second pass
      exports: exportNames,
      externalImports,
      lines,
      ...(frameworkEntryByPath.has(relPath)
        ? { entryPoint: true, entryPointKind: frameworkEntryByPath.get(relPath) }
        : {}),
    };
  }

  // 3. Second pass — populate importedBy and build edges
  for (const [filePath, info] of Object.entries(files)) {
    for (const imported of info.imports) {
      if (files[imported]) {
        files[imported].importedBy.push(filePath);
        edges.push({ from: filePath, to: imported });
      }
    }
  }

  // 4. Git churn analysis (files changed most recently = more important)
  const gitChurn = analyzeGitChurn(repoPath);

  // 5. Compute file metrics
  for (const [filePath, info] of Object.entries(files)) {
    const depth = filePath.split('/').length - 1;
    const isEntry = entryPointSet.has(filePath);
    const churn = gitChurn[filePath] || 0;

    info.fanIn = info.importedBy.length;
    info.fanOut = info.imports.length;
    info.exportCount = info.exports.length;
    info.churn = churn;
    info.priority = (
      info.fanIn * 3.0 +
      info.exportCount * 1.5 +
      (isEntry ? 10.0 : 0) +
      churn * 2.0 +
      (1 / (depth + 1)) * 1.0
    );
  }

  // 6. Rank files by importance (descending priority)
  const ranked = Object.entries(files)
    .map(([path, info]) => ({ path, ...info }))
    .sort((a, b) => b.priority - a.priority);

  // 7. Find hub files — top files by fanIn
  const hubs = Object.entries(files)
    .filter(([, info]) => info.fanIn > 0)
    .sort(([, a], [, b]) => b.fanIn - a.fanIn)
    .slice(0, 20)
    .map(([path, info]) => ({
      path,
      fanIn: info.fanIn,
      fanOut: info.fanOut,
      exports: info.exports,
    }));

  // 8. Compute domain clustering via connected components
  const clusters = computeDomainClusters(files, edges);

  // 9. Identify hotspots (high churn + high lines)
  const hotspots = Object.entries(files)
    .filter(([, info]) => info.churn > 3 && info.lines > 50)
    .sort(([, a], [, b]) => (b.churn * b.lines) - (a.churn * a.lines))
    .slice(0, 10)
    .map(([path, info]) => ({ path, churn: info.churn, lines: info.lines }));

  return {
    files,
    edges,
    ranked,
    hubs,
    clusters,
    hotspots,
    entryPoints,
    frameworkEntryPoints: frameworkEntries,
    stats: {
      totalFiles: Object.keys(files).length,
      totalEdges: edges.length,
      totalExternalImports: new Set(
        Object.values(files).flatMap(f => f.externalImports)
      ).size,
    },
  };
}

// --- File walking ---

const SOURCE_EXTS = new Set(['.py', '.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs', '.rb', '.go', '.rs']);
const JS_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs']);

const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', 'dist', 'build', '.git',
  '.next', '.nuxt', 'vendor', 'coverage', 'third_party',
  'extern', 'deps', 'bower_components', '.bundle', 'Pods',
  '.cache', 'out', 'output', 'target',
]);

// Vendored/generated file patterns — skip these from the import graph
const VENDORED_FILE_RE = /\.min\.(js|css)$|\.bundle\.js$|[-.]generated\.|_generated\.|_pb2\.py$|\.pb\.go$|\.g\.dart$/;
const GENERATED_FIRST_LINE_RE = /^\s*\/\/\s*(Code generated|AUTO-GENERATED|This file is auto)|^\s*#\s*(This file is autogenerated|AUTO-GENERATED|Generated by)/i;
// LOCK_FILES is now owned by `./diff-classifier.js` (single source of truth
// for change-classification predicates). Imported above.

function isVendoredOrGenerated(entry, content) {
  if (LOCK_FILES.has(entry)) return true;
  if (VENDORED_FILE_RE.test(entry)) return true;
  // Check first line for generated markers (only if content provided)
  if (content) {
    const firstLine = content.slice(0, 200).split('\n')[0];
    if (GENERATED_FIRST_LINE_RE.test(firstLine)) return true;
  }
  return false;
}

function walkSourceFiles(repoPath, maxDepth = 12) {
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;

      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (SOURCE_EXTS.has(extname(entry)) && !VENDORED_FILE_RE.test(entry)) {
          results.push(full);
        }
      } catch { /* skip unreadable files */ }
    }
  }

  walk(repoPath, 0);
  return results;
}

// --- JS/TS and Python parsers ---
// Implementations moved to src/lib/parsers/typescript.js and src/lib/parsers/python.js
// (Phase 3 split — keeps graph-builder focused on orchestration). They are
// re-exported from this module's bottom for backwards-compat with callers.

// --- Python package root detection ---

/**
 * Detect Python source roots — directories from which absolute imports resolve.
 * Checks: repo root, plus common subdirs (backend/, src/, app/, etc.) that contain
 * pyproject.toml, setup.py, or __init__.py.
 */
function detectPythonRoots(repoPath) {
  const roots = [repoPath]; // always try repo root

  const candidates = ['backend', 'src', 'app', 'server', 'api', 'lib'];
  for (const dir of candidates) {
    const full = join(repoPath, dir);
    if (!existsSync(full)) continue;
    // Check if it looks like a Python package root
    if (existsSync(join(full, 'pyproject.toml')) ||
        existsSync(join(full, 'setup.py')) ||
        existsSync(join(full, '__init__.py')) ||
        existsSync(join(full, 'app')) || // common pattern: backend/app/
        existsSync(join(full, 'main.py'))) {
      roots.push(full);
    }
  }

  return roots;
}

// --- Import resolution ---

function isRelativeImport(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isPythonRelativeImport(specifier) {
  return specifier.startsWith('.');
}

/**
 * Resolve a JS/TS relative import to a repo-relative file path.
 * Tries extensions and /index variants.
 */
function resolveRelativeImport(repoPath, fromFile, specifier) {
  const fromDir = dirname(join(repoPath, fromFile));
  const targetBase = resolve(fromDir, specifier);
  const targetRel = relative(repoPath, targetBase);

  // If the specifier already has an extension, check directly
  if (extname(specifier)) {
    if (existsSync(targetBase)) {
      return targetRel;
    }
    return null;
  }

  // Try extensions
  const extensions = ['.js', '.ts', '.tsx', '.jsx', '.mjs'];
  for (const ext of extensions) {
    const candidate = targetBase + ext;
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }

  // Try /index variants (directory import)
  const indexExts = ['.js', '.ts', '.tsx', '.jsx'];
  for (const ext of indexExts) {
    const candidate = join(targetBase, 'index' + ext);
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }

  return null;
}

/**
 * Resolve a Python relative import to a repo-relative file path.
 * E.g. `.utils` in `app/services/main.py` -> `app/services/utils.py`
 */
function resolvePythonRelativeImport(repoPath, fromFile, specifier) {
  const fromDir = dirname(join(repoPath, fromFile));

  // Count leading dots
  let dots = 0;
  while (dots < specifier.length && specifier[dots] === '.') dots++;

  const modulePart = specifier.slice(dots);

  // Each dot means go up one directory (first dot = current, additional = parent)
  let baseDir = fromDir;
  for (let i = 1; i < dots; i++) {
    baseDir = dirname(baseDir);
  }

  if (!modulePart) {
    // Just dots — importing the package itself (__init__.py)
    const initPath = join(baseDir, '__init__.py');
    if (existsSync(initPath)) {
      return relative(repoPath, initPath);
    }
    return null;
  }

  // Convert dotted module path to filesystem path
  const parts = modulePart.split('.');
  const modulePath = join(baseDir, ...parts);

  // Try as a .py file
  const pyFile = modulePath + '.py';
  if (existsSync(pyFile)) {
    return relative(repoPath, pyFile);
  }

  // Try as a package (__init__.py)
  const initFile = join(modulePath, '__init__.py');
  if (existsSync(initFile)) {
    return relative(repoPath, initFile);
  }

  return null;
}

/**
 * Resolve an absolute Python import to a repo-relative file path.
 * Tries from multiple roots: repo root, then detected Python source roots.
 * E.g. `app.services.db` in a repo with `backend/app/services/db.py`
 *   → tries <repo>/app/services/db.py (miss)
 *   → tries <repo>/backend/app/services/db.py (hit)
 */
function resolvePythonAbsoluteImport(repoPath, specifier, pythonRoots = [repoPath]) {
  const parts = specifier.split('.');

  for (const root of pythonRoots) {
    const modulePath = join(root, ...parts);

    // Try as a .py file
    const pyFile = modulePath + '.py';
    if (existsSync(pyFile)) {
      return relative(repoPath, pyFile);
    }

    // Try as a package (__init__.py)
    const initFile = join(modulePath, '__init__.py');
    if (existsSync(initFile)) {
      return relative(repoPath, initFile);
    }
  }

  return null;
}

// --- Git churn analysis ---

/**
 * Analyze git history to find file change frequency (last 6 months).
 * Returns { "src/lib/scanner.js": 14, ... }
 */
function analyzeGitChurn(repoPath) {
  const churn = {};

  try {
    const output = execSync(
      'git log --format=format: --name-only --since="6 months ago"',
      { cwd: repoPath, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) {
        churn[trimmed] = (churn[trimmed] || 0) + 1;
      }
    }
  } catch {
    // Not a git repo or git not available — return empty
  }

  return churn;
}

// --- Domain clustering (connected components) ---

function computeDomainClusters(files, edges) {
  const filePaths = Object.keys(files);
  if (filePaths.length === 0) return { components: [], coupling: [] };

  // Build undirected adjacency list
  const adj = {};
  for (const filePath of filePaths) {
    adj[filePath] = new Set();
  }

  for (const edge of edges) {
    if (adj[edge.from] && adj[edge.to]) {
      adj[edge.from].add(edge.to);
      adj[edge.to].add(edge.from);
    }
  }

  // BFS to find connected components
  const visited = new Set();
  const components = [];

  for (const filePath of filePaths) {
    if (visited.has(filePath)) continue;

    const component = [];
    const queue = [filePath];
    visited.add(filePath);

    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);

      for (const neighbor of adj[current]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  // Label each component by its primary directory and compute coupling
  const clusters = components.map(component => {
    // Count directories to find the primary one
    const dirCounts = {};
    for (const filePath of component) {
      const topDir = filePath.split('/')[0] || filePath;
      dirCounts[topDir] = (dirCounts[topDir] || 0) + 1;
    }

    const primaryDir = Object.entries(dirCounts)
      .sort(([, a], [, b]) => b - a)[0][0];

    return {
      label: primaryDir,
      files: component,
      size: component.length,
    };
  });

  // Compute coupling between components (cross-component edges)
  const fileToCluster = {};
  for (let i = 0; i < clusters.length; i++) {
    for (const filePath of clusters[i].files) {
      fileToCluster[filePath] = i;
    }
  }

  const couplingMap = {};
  for (const edge of edges) {
    const fromCluster = fileToCluster[edge.from];
    const toCluster = fileToCluster[edge.to];
    if (fromCluster !== undefined && toCluster !== undefined && fromCluster !== toCluster) {
      const key = [Math.min(fromCluster, toCluster), Math.max(fromCluster, toCluster)].join('-');
      couplingMap[key] = (couplingMap[key] || 0) + 1;
    }
  }

  const coupling = Object.entries(couplingMap).map(([key, count]) => {
    const [a, b] = key.split('-').map(Number);
    return {
      from: clusters[a].label,
      to: clusters[b].label,
      edges: count,
    };
  }).sort((a, b) => b.edges - a.edges);

  return {
    components: clusters.sort((a, b) => b.size - a.size),
    coupling,
  };
}

// --- Helpers ---

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function dedupeStrings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Best-effort `scanRepo()` for framework detection. Returns minimal scan
 * shape on failure so framework detectors can no-op.
 */
function safeScanForFrameworks(repoPath) {
  try {
    return scanRepo(repoPath);
  } catch {
    return { frameworks: [], dependencies: {} };
  }
}

// Re-export moved parsers for backwards-compat with callers that import from
// graph-builder.js (e.g. tests/graph-builder.test.js).
export {
  parseJsImports,
  parsePyImports,
  resolveRelativeImport,
  computeDomainClusters,
};
