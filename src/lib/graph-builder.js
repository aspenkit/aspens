import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { init, parse } from 'es-module-lexer';
import { detectEntryPoints } from './scanner.js';
import { extractDefinitions, stripForScanning, buildIntraDirectoryEdges, INTRA_DIR_EXTS } from './symbol-extractor.js';

/**
 * Build the import graph for a repository.
 * Returns adjacency list, edges, file metrics, hub files, and domain clusters.
 */
export async function buildRepoGraph(repoPath, languages = []) {
  await init;

  const entryPoints = detectEntryPoints(repoPath);
  const entryPointSet = new Set(entryPoints);

  // Load path aliases from tsconfig.json (e.g. "@/*": ["./src/*"])
  const pathAliases = loadPathAliases(repoPath);

  // Detect Python package roots (directories containing pyproject.toml, setup.py, or __init__.py at top level)
  const pythonRoots = detectPythonRoots(repoPath);

  // Detect Go module path from go.mod
  const goModulePath = detectGoModulePath(repoPath);

  // Detect Rust crate root (src/ directory under Cargo.toml)
  const rustCrateRoot = detectRustCrateRoot(repoPath);

  // Detect Java/Kotlin source roots (src/main/java, src/main/kotlin, src/, etc.)
  const javaSourceRoots = detectJavaSourceRoots(repoPath);

  // Detect PHP PSR-4 autoload mappings from composer.json
  const phpAutoload = detectPhpAutoload(repoPath);

  // Detect Dart package name from pubspec.yaml
  const dartPackageName = detectDartPackageName(repoPath);

  // Detect C# namespace roots from .csproj files
  const csharpRoots = detectCsharpRoots(repoPath);

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
    } else if (ext === '.go') {
      rawImports = parseGoImports(content);
    } else if (ext === '.rs') {
      rawImports = parseRsImports(content);
    } else if (JAVA_EXTS.has(ext)) {
      rawImports = parseJavaImports(content);
    } else if (C_CPP_EXTS.has(ext)) {
      rawImports = parseCppImports(content);
    } else if (ext === '.rb') {
      rawImports = parseRubyImports(content);
    } else if (ext === '.php') {
      rawImports = parsePhpImports(content);
    } else if (ext === '.swift') {
      rawImports = parseSwiftImports(content);
    } else if (ext === '.dart') {
      rawImports = parseDartImports(content);
    } else if (ext === '.cs') {
      rawImports = parseCsharpImports(content);
    } else if (ext === '.scala') {
      rawImports = parseScalaImports(content);
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
      } else if (ext === '.go') {
        const resolved = resolveGoImport(repoPath, specifier, goModulePath);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.rs') {
        const resolved = resolveRsImport(repoPath, relPath, specifier, rustCrateRoot);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (JAVA_EXTS.has(ext)) {
        const resolved = resolveJavaImport(repoPath, specifier, javaSourceRoots);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (C_CPP_EXTS.has(ext)) {
        const resolved = resolveCppImport(repoPath, relPath, specifier);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.rb') {
        const resolved = resolveRubyImport(repoPath, relPath, specifier);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.php') {
        const resolved = resolvePhpImport(repoPath, relPath, specifier, phpAutoload);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.swift') {
        // Swift module imports are mostly external frameworks; internal files are implicit
        externalImports.push(specifier);
      } else if (ext === '.dart') {
        const resolved = resolveDartImport(repoPath, relPath, specifier, dartPackageName);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.cs') {
        const resolved = resolveCsharpImport(repoPath, specifier, csharpRoots);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else if (ext === '.scala') {
        const resolved = resolveScalaImport(repoPath, specifier, javaSourceRoots);
        if (resolved) {
          internalImports.push(resolved);
        } else {
          externalImports.push(specifier);
        }
      } else {
        externalImports.push(specifier);
      }
    }

    // Extract symbol definitions for intra-directory edge building
    let definitions = [];
    let strippedContent = '';
    if (INTRA_DIR_EXTS.has(ext)) {
      strippedContent = stripForScanning(content, ext);
      definitions = extractDefinitions(strippedContent, ext);
    }

    files[relPath] = {
      imports: internalImports,
      importedBy: [],  // populated in second pass
      exports: exportNames,
      externalImports,
      lines,
      definitions,
      strippedContent,
      ext,
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

  // 3.5 Build intra-directory symbol edges (Go, Java, Kotlin, C#, Swift, Scala)
  const existingEdgeSet = new Set(edges.map(e => `${e.from}\0${e.to}`));
  const symbolEdges = buildIntraDirectoryEdges(files);
  for (const edge of symbolEdges) {
    const key = `${edge.from}\0${edge.to}`;
    if (!existingEdgeSet.has(key)) {
      edges.push(edge);
      existingEdgeSet.add(key);
      if (files[edge.to]) files[edge.to].importedBy.push(edge.from);
      if (files[edge.from]) files[edge.from].imports.push(edge.to);
    }
  }

  // Clean up temporary fields (don't persist in graph)
  for (const info of Object.values(files)) {
    delete info.strippedContent;
    delete info.ext;
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

const SOURCE_EXTS = new Set([
  '.py', '.ts', '.js', '.tsx', '.jsx', '.mjs', '.rb', '.go', '.rs',
  '.java', '.kt', '.kts',           // Java, Kotlin
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',  // C/C++
  '.cs',                             // C#
  '.php',                            // PHP
  '.swift',                          // Swift
  '.dart',                           // Dart
  '.scala',                          // Scala
]);
const JS_EXTS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs']);
const JAVA_EXTS = new Set(['.java', '.kt', '.kts']);
const C_CPP_EXTS = new Set(['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx']);

const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', 'dist', 'build', '.git',
  '.next', '.nuxt', 'vendor', 'coverage', 'third_party',
  'extern', 'deps', 'bower_components', '.bundle', 'Pods',
  '.cache', 'out', 'output', 'target',
]);

// Vendored/generated file patterns — skip these from the import graph
const VENDORED_FILE_RE = /\.min\.(js|css)$|\.bundle\.js$|[-.]generated\.|_generated\.|_pb2\.py$|\.pb\.go$|\.g\.dart$/;
const GENERATED_FIRST_LINE_RE = /^\s*\/\/\s*(Code generated|AUTO-GENERATED|This file is auto)|^\s*#\s*(This file is autogenerated|AUTO-GENERATED|Generated by)/i;
const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'go.sum',
  'composer.lock', 'Pipfile.lock',
]);

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

// --- JS/TS import parsing ---

async function parseJsImports(content, relPath) {
  await init;
  const result = { imports: [], exports: [] };

  try {
    const [imports, exports] = parse(content);

    for (const imp of imports) {
      // imp.n is the import specifier (null for dynamic imports without a string literal)
      if (imp.n) {
        result.imports.push(imp.n);
      }
    }

    for (const exp of exports) {
      if (exp.n) {
        result.exports.push(exp.n);
      }
    }
  } catch {
    // File couldn't be parsed — skip silently
  }

  return result;
}

// --- Python import parsing ---

const PY_FROM_IMPORT_RE = /^from\s+(\.+[\w.]*|[\w.]+)\s+import\s+/gm;
const PY_IMPORT_RE = /^import\s+([\w.]+)/gm;

function parsePyImports(content) {
  const imports = [];

  // Strip triple-quoted strings to avoid matching imports in docstrings
  const stripped = content.replace(/('{3}|"{3})[\s\S]*?\1/g, '');

  let match;

  // Reset lastIndex for global regexes
  PY_FROM_IMPORT_RE.lastIndex = 0;
  while ((match = PY_FROM_IMPORT_RE.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  PY_IMPORT_RE.lastIndex = 0;
  while ((match = PY_IMPORT_RE.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

// --- Go import parsing ---

/**
 * Read go.mod to extract the module path (e.g. "github.com/user/repo").
 * Returns null if go.mod doesn't exist or can't be parsed.
 */
function detectGoModulePath(repoPath) {
  const goModPath = join(repoPath, 'go.mod');
  const content = readFileSafe(goModPath);
  if (!content) return null;

  const match = content.match(/^module\s+(\S+)/m);
  return match ? match[1] : null;
}

/**
 * Parse Go import statements.
 * Handles both single imports: `import "pkg"`
 * and grouped imports: `import ( "pkg1" \n "pkg2" )`
 */
function parseGoImports(content) {
  const imports = [];

  // Strip block comments and line comments to avoid false matches
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // Single import: import "pkg"
  const singleRe = /^import\s+"([^"]+)"/gm;
  let match;
  while ((match = singleRe.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  // Grouped import: import ( "pkg1" \n "pkg2" )
  const groupRe = /^import\s*\(([^)]*)\)/gm;
  while ((match = groupRe.exec(stripped)) !== null) {
    const block = match[1];
    const lineRe = /"([^"]+)"/g;
    let lineMatch;
    while ((lineMatch = lineRe.exec(block)) !== null) {
      imports.push(lineMatch[1]);
    }
  }

  return imports;
}

/**
 * Resolve a Go import to a repo-relative directory path.
 * Internal imports start with the module path from go.mod.
 * Returns the relative path if the directory exists, null otherwise.
 */
function resolveGoImport(repoPath, specifier, goModulePath) {
  if (!goModulePath || !specifier.startsWith(goModulePath)) return null;

  // Strip module path prefix to get the relative package dir
  const relDir = specifier.slice(goModulePath.length).replace(/^\//, '');
  if (!relDir) return null; // importing the root package itself

  const absDir = join(repoPath, relDir);
  if (!existsSync(absDir)) return null;

  // Find the first .go file in the directory to use as the edge target
  // (Go packages are directory-based, so we pick a representative file)
  try {
    const entries = readdirSync(absDir);
    for (const entry of entries) {
      if (extname(entry) === '.go' && !entry.endsWith('_test.go') && !isVendoredOrGenerated(entry, null)) {
        return join(relDir, entry);
      }
    }
  } catch { /* skip */ }

  return null;
}

// --- Rust import parsing ---

/**
 * Parse Rust use/mod statements that reference internal modules.
 * Returns raw specifiers like "crate::models::user", "super::utils", "self::helpers".
 * Also captures `mod foo;` declarations.
 */
function parseRsImports(content) {
  const imports = [];

  // Strip block comments and line comments
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // `use crate::path::to::module;` or `use crate::path::{A, B};`
  const useRe = /\buse\s+(crate::[^;{]+|super::[^;{]+|self::[^;{]+)/g;
  let match;
  while ((match = useRe.exec(stripped)) !== null) {
    // Normalize: strip trailing `::*` or `::{...}` to get the module path
    let path = match[1].trim();
    // Remove glob imports like ::*
    path = path.replace(/::?\*$/, '');
    // Remove brace groups like ::{A, B} — keep the prefix
    path = path.replace(/::\{[^}]*\}$/, '');
    // Clean trailing :: left after removing braces/globs
    path = path.replace(/::$/, '');
    // Remove `as Alias`
    path = path.replace(/\s+as\s+\w+$/, '');
    if (path) imports.push(path);
  }

  // `mod foo;` — external module declaration (not inline `mod foo { ... }`)
  const modRe = /\bmod\s+(\w+)\s*;/g;
  while ((match = modRe.exec(stripped)) !== null) {
    imports.push(`mod::${match[1]}`);
  }

  return imports;
}

/**
 * Find the Rust crate root directory.
 * Looks for Cargo.toml and returns the src/ directory.
 */
function detectRustCrateRoot(repoPath) {
  // Check repo root
  if (existsSync(join(repoPath, 'Cargo.toml'))) {
    const srcDir = join(repoPath, 'src');
    if (existsSync(srcDir)) return srcDir;
    return repoPath;
  }
  return null;
}

/**
 * Resolve a Rust import specifier to a repo-relative file path.
 */
function resolveRsImport(repoPath, fromFile, specifier, crateRoot) {
  const fromDir = dirname(join(repoPath, fromFile));

  if (specifier.startsWith('mod::')) {
    // `mod foo;` → look for foo.rs or foo/mod.rs in same directory
    const modName = specifier.slice(5);
    const candidate1 = join(fromDir, modName + '.rs');
    if (existsSync(candidate1)) return relative(repoPath, candidate1);
    const candidate2 = join(fromDir, modName, 'mod.rs');
    if (existsSync(candidate2)) return relative(repoPath, candidate2);
    return null;
  }

  if (specifier.startsWith('crate::')) {
    if (!crateRoot) return null;
    // crate:: refers to the crate root (src/)
    const parts = specifier.slice(7).split('::');
    return resolveRsPath(repoPath, crateRoot, parts);
  }

  if (specifier.startsWith('super::')) {
    const parts = specifier.slice(7).split('::');
    // super means parent module — go up one directory from current file
    const parentDir = dirname(fromDir);
    return resolveRsPath(repoPath, parentDir, parts);
  }

  if (specifier.startsWith('self::')) {
    const parts = specifier.slice(6).split('::');
    return resolveRsPath(repoPath, fromDir, parts);
  }

  return null;
}

/**
 * Resolve a sequence of Rust path segments to a file.
 * Tries: base/a/b.rs, base/a/b/mod.rs, base/a.rs (for single segment)
 */
function resolveRsPath(repoPath, baseDir, parts) {
  if (parts.length === 0) return null;

  // Try as a file: base/part1/part2/.../partN.rs
  const asFile = join(baseDir, ...parts) + '.rs';
  if (existsSync(asFile)) return relative(repoPath, asFile);

  // Try as a directory with mod.rs: base/part1/.../partN/mod.rs
  const asMod = join(baseDir, ...parts, 'mod.rs');
  if (existsSync(asMod)) return relative(repoPath, asMod);

  // For multi-segment paths, the last segment might be an item (struct/fn) in the module
  // Try resolving without the last segment
  if (parts.length > 1) {
    const parentParts = parts.slice(0, -1);
    const asParentFile = join(baseDir, ...parentParts) + '.rs';
    if (existsSync(asParentFile)) return relative(repoPath, asParentFile);
    const asParentMod = join(baseDir, ...parentParts, 'mod.rs');
    if (existsSync(asParentMod)) return relative(repoPath, asParentMod);
  }

  return null;
}

// --- Java/Kotlin import parsing ---

/**
 * Parse Java and Kotlin import statements.
 * Handles: `import com.example.Foo;` and `import static com.example.Foo.bar;`
 * Kotlin: `import com.example.Foo` (no semicolon required)
 */
function parseJavaImports(content) {
  const imports = [];

  // Strip block and line comments
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const re = /^\s*import\s+(?:static\s+)?([\w.]+)/gm;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Detect Java/Kotlin source roots.
 * Checks: src/main/java, src/main/kotlin, src/, app/src/main/java, etc.
 */
function detectJavaSourceRoots(repoPath) {
  const roots = [];

  // Maven/Gradle standard layouts
  const candidates = [
    'src/main/java',
    'src/main/kotlin',
    'src/main/scala',
    'src',
    'app/src/main/java',      // Android
    'app/src/main/kotlin',    // Android
  ];

  for (const candidate of candidates) {
    const full = join(repoPath, candidate);
    if (existsSync(full) && statSync(full).isDirectory()) {
      roots.push(full);
    }
  }

  // Also check for multi-module Gradle/Maven projects
  for (const mono of ['modules', 'services', 'libs', 'subprojects']) {
    const monoDir = join(repoPath, mono);
    if (!existsSync(monoDir)) continue;
    try {
      for (const entry of readdirSync(monoDir)) {
        const full = join(monoDir, entry);
        if (!statSync(full).isDirectory()) continue;
        for (const srcDir of ['src/main/java', 'src/main/kotlin', 'src/main/scala']) {
          const srcPath = join(full, srcDir);
          if (existsSync(srcPath)) roots.push(srcPath);
        }
      }
    } catch { /* skip */ }
  }

  if (roots.length === 0) roots.push(repoPath);
  return roots;
}

/**
 * Resolve a Java/Kotlin/Scala import to a repo-relative file path.
 * Converts dotted package path to directory path and tries extensions.
 */
function resolveJavaImport(repoPath, specifier, sourceRoots) {
  // Convert com.example.models.User → com/example/models/User
  const parts = specifier.split('.');
  const pathSegments = parts.join('/');

  for (const root of sourceRoots) {
    // Try as a direct file
    for (const ext of ['.java', '.kt', '.kts', '.scala']) {
      const candidate = join(root, pathSegments + ext);
      if (existsSync(candidate)) {
        return relative(repoPath, candidate);
      }
    }

    // The last segment might be a class inside a file named after the package
    // e.g. import com.example.utils.StringHelper → com/example/utils.java contains StringHelper
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      for (const ext of ['.java', '.kt', '.kts', '.scala']) {
        const candidate = join(root, parentPath + ext);
        if (existsSync(candidate)) {
          return relative(repoPath, candidate);
        }
      }
    }
  }

  return null;
}

// --- C/C++ import parsing ---

/**
 * Parse C/C++ #include directives.
 * `#include "local.h"` → internal (prefixed with `quote:`)
 * `#include <system.h>` → external (prefixed with `angle:`)
 */
function parseCppImports(content) {
  const imports = [];

  // Strip block comments (but not line comments — #include can't be in those)
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // Quoted includes — likely internal
  const quoteRe = /^\s*#\s*include\s+"([^"]+)"/gm;
  let match;
  while ((match = quoteRe.exec(stripped)) !== null) {
    imports.push('quote:' + match[1]);
  }

  // Angle bracket includes — likely external/system
  const angleRe = /^\s*#\s*include\s+<([^>]+)>/gm;
  while ((match = angleRe.exec(stripped)) !== null) {
    imports.push('angle:' + match[1]);
  }

  return imports;
}

/**
 * Resolve a C/C++ quoted #include to a repo-relative file path.
 * Angle-bracket includes are treated as external.
 */
function resolveCppImport(repoPath, fromFile, specifier) {
  // Angle bracket includes are external
  if (specifier.startsWith('angle:')) return null;

  // Strip the quote: prefix
  const includePath = specifier.slice(6);

  const fromDir = dirname(join(repoPath, fromFile));

  // Try relative to the including file first
  const relCandidate = join(fromDir, includePath);
  if (existsSync(relCandidate)) {
    return relative(repoPath, relCandidate);
  }

  // Try from repo root (common for projects with include paths at root)
  const rootCandidate = join(repoPath, includePath);
  if (existsSync(rootCandidate)) {
    return relative(repoPath, rootCandidate);
  }

  // Try common include directories
  for (const includeDir of ['include', 'inc', 'src', 'lib']) {
    const candidate = join(repoPath, includeDir, includePath);
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }

  return null;
}

// --- Ruby import parsing ---

/**
 * Parse Ruby require/require_relative statements.
 * `require_relative './foo'` → prefixed with `rel:`
 * `require 'foo'` → bare (could be gem or internal)
 */
function parseRubyImports(content) {
  const imports = [];

  // Strip block comments (=begin...=end) and line comments
  const stripped = content
    .replace(/^=begin[\s\S]*?^=end/gm, '')
    .replace(/#.*$/gm, '');

  // require_relative — always internal
  const relRe = /\brequire_relative\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = relRe.exec(stripped)) !== null) {
    imports.push('rel:' + match[1]);
  }

  // require — could be gem or internal
  const reqRe = /\brequire\s+['"]([^'"]+)['"]/g;
  while ((match = reqRe.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Resolve a Ruby import to a repo-relative file path.
 */
function resolveRubyImport(repoPath, fromFile, specifier) {
  const fromDir = dirname(join(repoPath, fromFile));

  if (specifier.startsWith('rel:')) {
    // require_relative — resolve relative to the requiring file
    const relPath = specifier.slice(4);
    const candidate = join(fromDir, relPath);

    // Try with .rb extension
    if (existsSync(candidate + '.rb')) {
      return relative(repoPath, candidate + '.rb');
    }
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
    return null;
  }

  // Plain require — try from repo root and lib/
  for (const root of [repoPath, join(repoPath, 'lib'), join(repoPath, 'app')]) {
    const candidate = join(root, specifier);
    if (existsSync(candidate + '.rb')) {
      return relative(repoPath, candidate + '.rb');
    }
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }

  // Try Rails-style autoloading: app/models, app/controllers, etc.
  for (const railsDir of ['app/models', 'app/controllers', 'app/services', 'app/helpers', 'app/mailers', 'app/jobs']) {
    const candidate = join(repoPath, railsDir, specifier);
    if (existsSync(candidate + '.rb')) {
      return relative(repoPath, candidate + '.rb');
    }
  }

  return null;
}

// --- PHP import parsing ---

/**
 * Parse PHP use/require/include statements.
 * `use App\Models\User;` → namespace import
 * `require_once 'path/to/file.php';` → file import (prefixed with `file:`)
 */
function parsePhpImports(content) {
  const imports = [];

  // Strip block and line comments
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '');

  // Namespace use statements
  const useRe = /\buse\s+([\w\\]+)/g;
  let match;
  while ((match = useRe.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  // require/include/require_once/include_once with string paths
  const fileRe = /\b(?:require|include)(?:_once)?\s+['"]([^'"]+)['"]/g;
  while ((match = fileRe.exec(stripped)) !== null) {
    imports.push('file:' + match[1]);
  }

  return imports;
}

/**
 * Detect PHP PSR-4 autoload mappings from composer.json.
 * Returns array of { prefix, directory } for namespace → directory mapping.
 */
function detectPhpAutoload(repoPath) {
  const mappings = [];
  const composerPath = join(repoPath, 'composer.json');
  const content = readFileSafe(composerPath);
  if (!content) return mappings;

  try {
    const config = JSON.parse(content);
    const psr4 = config?.autoload?.['psr-4'];
    if (psr4) {
      for (const [prefix, dir] of Object.entries(psr4)) {
        const directory = Array.isArray(dir) ? dir[0] : dir;
        mappings.push({ prefix, directory: join(repoPath, directory) });
      }
    }
  } catch { /* malformed composer.json */ }

  return mappings;
}

/**
 * Resolve a PHP import to a repo-relative file path.
 */
function resolvePhpImport(repoPath, fromFile, specifier, autoload) {
  const fromDir = dirname(join(repoPath, fromFile));

  // File-based imports (require/include)
  if (specifier.startsWith('file:')) {
    const filePath = specifier.slice(5);
    // Try relative to the file
    const relCandidate = join(fromDir, filePath);
    if (existsSync(relCandidate)) return relative(repoPath, relCandidate);
    // Try from repo root
    const rootCandidate = join(repoPath, filePath);
    if (existsSync(rootCandidate)) return relative(repoPath, rootCandidate);
    return null;
  }

  // Namespace imports — try PSR-4 autoload mappings
  const nsPath = specifier.replace(/\\/g, '/');

  for (const { prefix, directory } of autoload) {
    const nsPrefix = prefix.replace(/\\/g, '/');
    if (!nsPath.startsWith(nsPrefix)) continue;

    const rest = nsPath.slice(nsPrefix.length);
    const candidate = join(directory, rest + '.php');
    if (existsSync(candidate)) {
      return relative(repoPath, candidate);
    }
  }

  // Fallback: try converting namespace to path directly
  const directCandidate = join(repoPath, nsPath + '.php');
  if (existsSync(directCandidate)) {
    return relative(repoPath, directCandidate);
  }

  // Try in src/
  const srcCandidate = join(repoPath, 'src', nsPath + '.php');
  if (existsSync(srcCandidate)) {
    return relative(repoPath, srcCandidate);
  }

  return null;
}

// --- Swift import parsing ---

/**
 * Parse Swift import statements.
 * `import Foundation` — module import
 * `import struct MyApp.Models.User` — selective import
 * Note: Swift files within the same module/target can see each other implicitly.
 * We capture module imports for cross-module edge detection.
 */
function parseSwiftImports(content) {
  const imports = [];

  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const re = /^\s*import\s+(?:class|struct|enum|protocol|typealias|func|var|let)?\s*([\w.]+)/gm;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

// --- Dart import parsing ---

/**
 * Parse Dart import and part directives.
 * `import 'package:myapp/models/user.dart';` → package import
 * `import '../utils/helpers.dart';` → relative import
 * `part 'user_model.g.dart';` → part directive
 */
function parseDartImports(content) {
  const imports = [];

  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // import and part directives
  const re = /^\s*(?:import|part|export)\s+['"]([^'"]+)['"]/gm;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Detect Dart package name from pubspec.yaml.
 */
function detectDartPackageName(repoPath) {
  const pubspecPath = join(repoPath, 'pubspec.yaml');
  const content = readFileSafe(pubspecPath);
  if (!content) return null;

  const match = content.match(/^name:\s*(\S+)/m);
  return match ? match[1] : null;
}

/**
 * Resolve a Dart import to a repo-relative file path.
 */
function resolveDartImport(repoPath, fromFile, specifier, packageName) {
  const fromDir = dirname(join(repoPath, fromFile));

  // Relative imports
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const candidate = join(fromDir, specifier);
    if (existsSync(candidate)) return relative(repoPath, candidate);
    return null;
  }

  // Package imports referencing own package: package:myapp/path.dart → lib/path.dart
  if (packageName && specifier.startsWith(`package:${packageName}/`)) {
    const rest = specifier.slice(`package:${packageName}/`.length);
    const candidate = join(repoPath, 'lib', rest);
    if (existsSync(candidate)) return relative(repoPath, candidate);
    return null;
  }

  // dart:core, package:other_package/... → external
  return null;
}

// --- C# import parsing ---

/**
 * Parse C# using directives.
 * `using System.Collections.Generic;`
 * `using MyApp.Models;`
 * `using static MyApp.Helpers.StringUtils;`
 */
function parseCsharpImports(content) {
  const imports = [];

  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const re = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Detect C# project source roots from .csproj files.
 */
function detectCsharpRoots(repoPath) {
  const roots = [];

  // Find .csproj files at top level and one level deep
  try {
    const entries = readdirSync(repoPath);
    for (const entry of entries) {
      if (entry.endsWith('.csproj')) {
        roots.push(repoPath);
        break;
      }
      const full = join(repoPath, entry);
      try {
        if (statSync(full).isDirectory()) {
          const subEntries = readdirSync(full);
          if (subEntries.some(e => e.endsWith('.csproj'))) {
            roots.push(full);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // Also check src/ subdirectories
  const srcDir = join(repoPath, 'src');
  if (existsSync(srcDir)) {
    try {
      for (const entry of readdirSync(srcDir)) {
        const full = join(srcDir, entry);
        if (statSync(full).isDirectory()) {
          const subEntries = readdirSync(full);
          if (subEntries.some(e => e.endsWith('.csproj'))) {
            roots.push(full);
          }
        }
      }
    } catch { /* skip */ }
  }

  if (roots.length === 0) roots.push(repoPath);
  return roots;
}

/**
 * Resolve a C# using directive to a repo-relative file path.
 * Converts dotted namespace to directory/file path.
 */
function resolveCsharpImport(repoPath, specifier, csharpRoots) {
  // Standard library namespaces
  if (specifier.startsWith('System') || specifier.startsWith('Microsoft') ||
      specifier.startsWith('Newtonsoft') || specifier.startsWith('NUnit') ||
      specifier.startsWith('Xunit')) {
    return null;
  }

  const parts = specifier.split('.');
  const pathSegments = parts.join('/');

  for (const root of csharpRoots) {
    // Try as a .cs file
    const candidate = join(root, pathSegments + '.cs');
    if (existsSync(candidate)) return relative(repoPath, candidate);

    // Try the last part as a file in the parent namespace directory
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      const file = parts[parts.length - 1] + '.cs';
      const candidate2 = join(root, dir, file);
      if (existsSync(candidate2)) return relative(repoPath, candidate2);
    }

    // Try just the directory (namespace might map to a directory with multiple files)
    const dirCandidate = join(root, pathSegments);
    if (existsSync(dirCandidate) && statSync(dirCandidate).isDirectory()) {
      // Pick the first .cs file in the directory
      try {
        const entries = readdirSync(dirCandidate);
        for (const entry of entries) {
          if (entry.endsWith('.cs')) {
            return relative(repoPath, join(dirCandidate, entry));
          }
        }
      } catch { /* skip */ }
    }
  }

  return null;
}

// --- Scala import parsing ---

/**
 * Parse Scala import statements.
 * `import com.example.models.User`
 * `import com.example.models._`
 * `import com.example.models.{User, Post}`
 */
function parseScalaImports(content) {
  const imports = [];

  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const re = /^\s*import\s+([\w.]+)/gm;
  let match;
  while ((match = re.exec(stripped)) !== null) {
    let path = match[1];
    // Remove trailing ._ (wildcard import)
    path = path.replace(/\._$/, '');
    imports.push(path);
  }

  return imports;
}

/**
 * Resolve a Scala import — reuses Java source root detection and resolution.
 */
function resolveScalaImport(repoPath, specifier, sourceRoots) {
  return resolveJavaImport(repoPath, specifier, sourceRoots);
}

// --- Path alias loading ---

/**
 * Load path aliases from tsconfig.json (e.g. "@/*": ["./src/*"]).
 * Returns array of { prefix, replacement } for resolution.
 */
function loadPathAliases(repoPath) {
  const aliases = [];

  // Collect candidate tsconfig/jsconfig locations:
  // 1. Repo root
  // 2. Common subdirectories (frontend/, apps/*, packages/*)
  const configLocations = [repoPath];
  const subdirCandidates = ['frontend', 'web', 'client', 'app', 'src'];
  for (const sub of subdirCandidates) {
    const full = join(repoPath, sub);
    if (existsSync(full) && statSync(full).isDirectory()) {
      configLocations.push(full);
    }
  }
  // Also check apps/* and packages/* for monorepos
  for (const mono of ['apps', 'packages']) {
    const monoDir = join(repoPath, mono);
    if (!existsSync(monoDir)) continue;
    try {
      for (const entry of readdirSync(monoDir)) {
        const full = join(monoDir, entry);
        if (statSync(full).isDirectory()) configLocations.push(full);
      }
    } catch { /* skip */ }
  }

  for (const configDir of configLocations) {
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = join(configDir, configName);
      if (!existsSync(configPath)) continue;

      try {
        const content = readFileSafe(configPath);
        if (!content) continue;

        // Strip comments for JSON parsing — careful not to mangle strings
        const stripped = content
          .replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (m, str) => str || '')
          .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
          .replace(/,\s*([\]}])/g, '$1'); // trailing commas

        const config = JSON.parse(stripped);
        const paths = config?.compilerOptions?.paths;
        const baseUrl = config?.compilerOptions?.baseUrl || '.';

        if (paths) {
          for (const [pattern, targets] of Object.entries(paths)) {
            if (!targets || targets.length === 0) continue;
            // "@/*" → prefix "@/", "*" is the wildcard
            const prefix = pattern.replace(/\*$/, '');
            const target = targets[0].replace(/\*$/, '');
            // Resolve relative to the tsconfig's directory, not repo root
            const replacement = join(configDir, baseUrl, target);
            aliases.push({ prefix, replacement });
          }
        }
      } catch { /* malformed config — skip */ }
    }
  }

  return aliases;
}

/**
 * Resolve an aliased import (e.g. @/components/Button) to a repo-relative path.
 */
function resolveAliasImport(repoPath, specifier, aliases) {
  for (const { prefix, replacement } of aliases) {
    if (!specifier.startsWith(prefix)) continue;

    const rest = specifier.slice(prefix.length);
    const targetBase = join(replacement, rest);

    // Try with extension
    if (extname(rest)) {
      if (existsSync(targetBase)) {
        return relative(repoPath, targetBase);
      }
      continue;
    }

    // Try extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs']) {
      const candidate = targetBase + ext;
      if (existsSync(candidate)) {
        return relative(repoPath, candidate);
      }
    }

    // Try /index variants
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const candidate = join(targetBase, 'index' + ext);
      if (existsSync(candidate)) {
        return relative(repoPath, candidate);
      }
    }
  }

  return null;
}

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

export {
  parseJsImports,
  parsePyImports,
  parseGoImports,
  parseRsImports,
  parseJavaImports,
  parseCppImports,
  parseRubyImports,
  parsePhpImports,
  parseSwiftImports,
  parseDartImports,
  parseCsharpImports,
  parseScalaImports,
  resolveRelativeImport,
  resolveGoImport,
  resolveRsImport,
  resolveJavaImport,
  resolveCppImport,
  resolveRubyImport,
  resolvePhpImport,
  resolveDartImport,
  resolveCsharpImport,
  resolveScalaImport,
  detectGoModulePath,
  detectRustCrateRoot,
  detectJavaSourceRoots,
  detectPhpAutoload,
  detectDartPackageName,
  detectCsharpRoots,
  computeDomainClusters,
};
