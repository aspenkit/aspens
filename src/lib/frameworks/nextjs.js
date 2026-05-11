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

import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';

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
 * @param {string} repoPath
 * @returns {Array<{path: string, kind: string}>}
 */
export function detectNextjsEntryPoints(repoPath) {
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
            path: relative(repoPath, full),
            kind: 'nextjs-middleware',
          });
        }
      }
    }
  }

  return dedupe(found);
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
      out.push({ path: relative(repoPath, full), kind: 'nextjs-app' });
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

    out.push({ path: relative(repoPath, full), kind: 'nextjs-pages' });
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
 * @param {string} repoPath
 * @returns {Array<{prefix: string, replacement: string}>}
 */
export function nextjsImplicitAliases(repoPath) {
  const aliases = [];
  const srcDir = join(repoPath, 'src');
  if (existsSync(srcDir) && safeIsDir(srcDir)) {
    aliases.push({ prefix: '@/', replacement: srcDir });
  } else {
    aliases.push({ prefix: '@/', replacement: repoPath });
  }
  return aliases;
}
