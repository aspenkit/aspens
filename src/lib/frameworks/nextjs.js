/**
 * Next.js framework detector — implicit entry points + path-alias defaults.
 *
 * App Router files (`page`, `layout`, `route`, `loading`, `error`,
 * `not-found`, `template`, `default`, `global-error`), Pages Router files
 * (legacy), and special files (`middleware`, `instrumentation`) are
 * "entry points" — Next.js runs them implicitly so they have no static
 * importer. We tag them so the import-graph priority ranker treats them as
 * roots.
 *
 * Code-bearing extensions only — metadata routes can also use png/jpg, but
 * those don't enter the JS/TS import graph.
 */

import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, basename, extname, resolve, sep } from 'path';
import { relativePosix } from '../posix-path.js';

const APP_ROUTER_FILE_NAMES = new Set([
  'page', 'layout', 'route', 'loading', 'error',
  'not-found', 'template', 'default', 'global-error',
]);

const METADATA_ROUTE_NAMES = new Set([
  'opengraph-image', 'twitter-image', 'icon', 'apple-icon',
  'sitemap', 'robots', 'manifest',
]);

const SPECIAL_TOPLEVEL_NAMES = new Set([
  'middleware', 'instrumentation',
]);

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const APP_DIR_CANDIDATES = ['app', 'src/app'];
const PAGES_DIR_CANDIDATES = ['pages', 'src/pages'];

/**
 * Returns true if this repo looks like a Next.js project.
 *
 * @param {{ frameworks?: string[], dependencies?: object }} scan
 * @returns {boolean}
 */
export function isNextjsProject(scan) {
  if (!scan) return false;
  if (Array.isArray(scan.frameworks) && scan.frameworks.some(f => /next/i.test(f))) return true;
  const deps = scan.dependencies || {};
  if (deps.next) return true;
  return false;
}

/**
 * Detect Next.js entry-point files.
 * Returns an array of { path, kind } where path is repo-relative and kind
 * is one of: 'nextjs-app', 'nextjs-pages', 'nextjs-middleware'.
 *
 * The router walkers also record each file's `stem` for
 * `probeNextjsArchitecture`; it is stripped from this function's result.
 *
 * @param {string} dirPath Repo root; normalised with resolve().
 * @returns {Array<{path: string, kind: string}>}
 */
export function detectNextjsEntryPoints(dirPath) {
  const repoPath = resolve(dirPath);
  const found = [];

  for (const candidate of APP_DIR_CANDIDATES) {
    const full = join(repoPath, candidate);
    if (existsSync(full) && safeIsDir(full)) {
      walkAppDir(repoPath, full, found);
    }
  }

  for (const candidate of PAGES_DIR_CANDIDATES) {
    const full = join(repoPath, candidate);
    if (existsSync(full) && safeIsDir(full)) {
      walkPagesDir(repoPath, full, found);
    }
  }

  for (const name of SPECIAL_TOPLEVEL_NAMES) {
    for (const ext of CODE_EXTS) {
      // Try root and src/
      for (const dir of ['', 'src']) {
        const full = dir ? join(repoPath, dir, name + ext) : join(repoPath, name + ext);
        if (existsSync(full) && safeIsFile(full)) {
          found.push({
            path: relativePosix(repoPath, full),
            kind: 'nextjs-middleware',
            stem: name,
          });
        }
      }
    }
  }

  // `stem` is internal to this module — entry points are a {path, kind} contract.
  return dedupe(found).map(({ path, kind }) => ({ path, kind }));
}

function walkAppDir(repoPath, dir, out, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walkAppDir(repoPath, full, out, depth + 1);
      continue;
    }

    const ext = extname(entry);
    if (!CODE_EXTS.has(ext)) continue;

    const stem = basename(entry, ext);
    if (APP_ROUTER_FILE_NAMES.has(stem) || METADATA_ROUTE_NAMES.has(stem)) {
      out.push({ path: relativePosix(repoPath, full), kind: 'nextjs-app', stem });
    }
  }
}

function walkPagesDir(repoPath, dir, out, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // skip hidden files/dirs (.DS_Store, .next/, etc.)
    // `_app` and `_document` are Pages Router entry equivalents — fall through.
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walkPagesDir(repoPath, full, out, depth + 1);
      continue;
    }

    const ext = extname(entry);
    if (!CODE_EXTS.has(ext)) continue;

    out.push({
      path: relativePosix(repoPath, full),
      kind: 'nextjs-pages',
      stem: basename(entry, ext),
    });
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
  }
  return out;
}

function safeIsDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function safeIsFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * Returns the implicit Next.js path alias when no tsconfig paths are configured.
 * Modern Next.js projects default to `@/*` → `./src/*` (or `./*` if no src).
 *
 * @param {string} dirPath Repo root; normalised with resolve().
 * @returns {Array<{prefix: string, replacement: string}>}
 */
export function nextjsImplicitAliases(dirPath) {
  const repoPath = resolve(dirPath);
  const aliases = [];
  const srcDir = join(repoPath, 'src');
  if (existsSync(srcDir) && safeIsDir(srcDir)) {
    aliases.push({ prefix: '@/', replacement: srcDir });
  } else {
    aliases.push({ prefix: '@/', replacement: repoPath });
  }
  return aliases;
}

// --- Architecture Probe ---

// Pages Router files that are framework plumbing, not routes.
const PAGES_SPECIAL_STEMS = new Set(['_app', '_document', '_error']);

// Never source, at any depth — nested `node_modules` included.
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '__pycache__']);

// Build output and assets, which only sit at a walk root. Deeper down these
// are ordinary names — `app/build/page.tsx` is a route, not a build artifact.
const ROOT_SKIP_DIRS = new Set(['dist', 'build', 'out', 'coverage', 'public']);

// Enough to clear a license header and reach the directive prologue.
const DIRECTIVE_HEAD_BYTES = 1024;

const DYNAMIC_SEGMENT = /^\[.+\]$/;
const ROUTE_GROUP = /^\(.+\)$/;

/**
 * Describe a Next.js project's routing architecture.
 *
 * Returns null when the repo is not a Next.js project — this is the only
 * part of the scan that reads file contents, so it stays gated.
 *
 * @param {string} dirPath Repo root; normalised with resolve().
 * @param {string[]} frameworks Detected framework slugs.
 * @returns {{
 *   router: 'app'|'pages'|'migrating'|null,
 *   appDir: string|null,
 *   pagesDir: string|null,
 *   routes: number,
 *   apiRoutes: number,
 *   dynamicRoutes: number,
 *   routeGroups: string[],
 *   clientComponents: number,
 *   serverComponents: number,
 *   middleware: boolean,
 * }|null}
 */
export function probeNextjsArchitecture(dirPath, frameworks) {
  if (!isNextjsProject({ frameworks })) return null;

  // Normalise once — directory containment is decided by string prefix below.
  const repoPath = resolve(dirPath);

  // An `app/` directory only means App Router once it has a layout.
  const appDir = APP_DIR_CANDIDATES.find(c => hasAppLayout(join(repoPath, c))) || null;
  const pagesDir = PAGES_DIR_CANDIDATES.find(c => safeIsDir(join(repoPath, c))) || null;

  const appFiles = [];
  if (appDir) walkAppDir(repoPath, join(repoPath, appDir), appFiles);

  const pagesFiles = [];
  if (pagesDir) walkPagesDir(repoPath, join(repoPath, pagesDir), pagesFiles);

  // A private folder opts itself and its children out of routing, but its
  // files are still server components.
  const routableAppFiles = appFiles.filter(f => !isPrivateAppPath(f.path));

  const apiPrefix = pagesDir ? `${pagesDir}/api/` : null;
  const pagesApiRoutes = pagesFiles.filter(f => f.path.startsWith(apiPrefix));
  const pagesRoutes = pagesFiles.filter(
    f => !f.path.startsWith(apiPrefix) && !isPagesPlumbing(pagesDir, f)
  );

  // Mid-migration both routers serve traffic, so route counts cover both.
  const appPages = dedupeByUrl(routableAppFiles.filter(f => f.stem === 'page'), appDir);
  const appApiRoutes = dedupeByUrl(routableAppFiles.filter(f => f.stem === 'route'), appDir);
  const routes = [...appPages, ...pagesRoutes];
  const apiRoutes = appApiRoutes.length + pagesApiRoutes.length;
  const components = classifyComponents(repoPath, appDir);

  return {
    router: routerType(appDir, pagesDir),
    appDir,
    pagesDir,
    routes: routes.length,
    apiRoutes,
    dynamicRoutes: routes.filter(f => hasDynamicSegment(f.path)).length,
    routeGroups: collectRouteGroups(routableAppFiles),
    clientComponents: components.client,
    serverComponents: components.server,
    middleware: hasMiddleware(repoPath),
  };
}

/**
 * Next.js opts an `_`-prefixed folder, and everything under it, out of routing.
 */
function isPrivateAppPath(posixPath) {
  return posixPath.split('/').some(segment => segment.startsWith('_'));
}

/**
 * `_app`, `_document` and `_error` are framework plumbing only at the Pages
 * Router root — `pages/docs/_error.tsx` is a route like any other.
 */
function isPagesPlumbing(pagesDir, file) {
  if (!PAGES_SPECIAL_STEMS.has(file.stem)) return false;
  return file.path.split('/').length === pagesDir.split('/').length + 1;
}

/**
 * Collapse App Router files that serve the same URL.
 *
 * Route groups and parallel route slots are organisational: `(shop)` and
 * `@modal` never reach the URL, so `app/@modal/photo/page.tsx` and
 * `app/photo/page.tsx` are two files behind one route.
 */
function dedupeByUrl(files, appDir) {
  const seen = new Set();
  return files.filter((file) => {
    const url = appRouteUrl(file.path, appDir);
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function appRouteUrl(posixPath, appDir) {
  const segments = posixPath.split('/').slice(appDir.split('/').length, -1);
  return '/' + segments.filter(s => !ROUTE_GROUP.test(s) && !s.startsWith('@')).join('/');
}

function routerType(appDir, pagesDir) {
  if (appDir && pagesDir) return 'migrating';
  if (appDir) return 'app';
  if (pagesDir) return 'pages';
  return null;
}

/**
 * A root layout is mandatory, but it need not sit directly under `app/`.
 * Multiple root layouts live one per route group (`app/(shop)/layout.tsx`),
 * with nothing at the app root, so route groups are searched recursively.
 */
function hasAppLayout(dir, depth = 0) {
  if (!safeIsDir(dir)) return false;
  for (const ext of CODE_EXTS) {
    if (safeIsFile(join(dir, `layout${ext}`))) return true;
  }
  if (depth >= 4) return false;

  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  return entries.some(entry => ROUTE_GROUP.test(entry) && hasAppLayout(join(dir, entry), depth + 1));
}

function hasMiddleware(repoPath) {
  for (const ext of CODE_EXTS) {
    if (safeIsFile(join(repoPath, `middleware${ext}`))) return true;
    if (safeIsFile(join(repoPath, 'src', `middleware${ext}`))) return true;
  }
  return false;
}

function hasDynamicSegment(posixPath) {
  return posixPath.split('/').some((segment) => {
    // App Router names the directory (`blog/[slug]/page.tsx`); Pages Router
    // names the file (`posts/[id].tsx`). Only strip a real code extension —
    // `extname('[...path]')` returns '.path]'.
    const ext = extname(segment);
    const stem = CODE_EXTS.has(ext) ? basename(segment, ext) : segment;
    return DYNAMIC_SEGMENT.test(stem);
  });
}

function collectRouteGroups(appFiles) {
  const groups = new Set();
  for (const file of appFiles) {
    for (const segment of file.path.split('/')) {
      if (ROUTE_GROUP.test(segment)) groups.add(segment);
    }
  }
  return [...groups].sort();
}

/**
 * Count client and server components.
 *
 * The two counts have different denominators on purpose. A `'use client'`
 * directive is explicit wherever it appears, so client components are counted
 * across the whole source root. "Server component by default" is an App Router
 * rule, so only files under the app directory count as server components —
 * `next.config.js` and `lib/` helpers are neither.
 */
function classifyComponents(repoPath, appDir) {
  const srcDir = join(repoPath, 'src');
  const sourceRoot = safeIsDir(srcDir) ? srcDir : repoPath;
  const appFull = appDir ? join(repoPath, appDir) : null;

  // A root-level `app/` alongside `src/` sits outside the source root.
  const roots = [sourceRoot];
  if (appFull && !isInside(sourceRoot, appFull)) roots.push(appFull);

  let client = 0;
  let server = 0;

  for (const root of roots) {
    // Build output only masquerades as source at the source root; an `app/`
    // root's own top-level names are URL segments.
    walkSourceFiles(root, (full) => {
      if (hasUseClientDirective(full)) client++;
      else if (appFull && isInside(appFull, full)) server++;
    }, 0, root === sourceRoot);
  }

  return { client, server };
}

function walkSourceFiles(dir, visit, depth = 0, rootSkip = true) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (ALWAYS_SKIP_DIRS.has(entry)) continue;
    if (depth === 0 && rootSkip && ROOT_SKIP_DIRS.has(entry)) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      walkSourceFiles(full, visit, depth + 1, rootSkip);
      continue;
    }

    // Only regular files — this walker's visitor opens what it is handed,
    // and opening a FIFO blocks.
    if (!stat.isFile()) continue;
    if (!CODE_EXTS.has(extname(entry))) continue;
    visit(full);
  }
}

function isInside(parent, child) {
  return child === parent || child.startsWith(parent + sep);
}

function hasUseClientDirective(filePath) {
  let fd;
  try { fd = openSync(filePath, 'r'); } catch { return false; }

  try {
    const buf = Buffer.alloc(DIRECTIVE_HEAD_BYTES);
    const read = readSync(fd, buf, 0, DIRECTIVE_HEAD_BYTES, 0);
    const head = buf.toString('utf8', 0, read).replace(/^\uFEFF/, '');
    return /^(['"])use client\1/.test(stripLeadingTrivia(head));
  } catch {
    return false;
  } finally {
    try { closeSync(fd); } catch { /* already gone */ }
  }
}

/**
 * Skip whitespace and comments so a directive behind a license header still
 * counts. An unterminated comment means the directive is out of reach.
 */
function stripLeadingTrivia(text) {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return '';
      i = nl + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return '';
      i = end + 2;
      continue;
    }
    break;
  }
  return text.slice(i);
}
