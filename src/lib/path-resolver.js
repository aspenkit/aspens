/**
 * Path-alias resolver for TypeScript / JavaScript projects.
 *
 * Reads `compilerOptions.paths` and `baseUrl` from `tsconfig.json` /
 * `jsconfig.json`, follows `extends` chains (capped at 5 levels), and resolves
 * aliased import specifiers (`@/components/Foo`, `~/utils`, etc.) to
 * repo-relative file paths.
 *
 * Standalone module: `graph-builder.js` is the orchestrator and should not
 * own path-resolution logic.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, extname, resolve, relative } from 'path';

const ALIAS_RESOLUTION_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const ALIAS_INDEX_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Load path aliases from tsconfig.json / jsconfig.json. Walks the repo root,
 * common subdirectories, and monorepo `apps/*` / `packages/*` for configs.
 *
 * @param {string} repoPath
 * @returns {Array<{prefix: string, replacement: string}>}
 */
export function loadPathAliases(repoPath) {
  const aliases = [];

  const configLocations = [repoPath];
  const subdirCandidates = ['frontend', 'web', 'client', 'app', 'src'];
  for (const sub of subdirCandidates) {
    const full = join(repoPath, sub);
    if (existsSync(full) && safeIsDir(full)) {
      configLocations.push(full);
    }
  }
  for (const mono of ['apps', 'packages']) {
    const monoDir = join(repoPath, mono);
    if (!existsSync(monoDir)) continue;
    try {
      for (const entry of readdirSync(monoDir)) {
        const full = join(monoDir, entry);
        if (safeIsDir(full)) configLocations.push(full);
      }
    } catch { /* skip */ }
  }

  for (const configDir of configLocations) {
    for (const configName of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = join(configDir, configName);
      if (!existsSync(configPath)) continue;

      try {
        const merged = loadTsconfigWithExtends(configPath);
        if (!merged) continue;

        const paths = merged?.compilerOptions?.paths;
        const baseUrl = merged?.compilerOptions?.baseUrl || '.';

        if (paths) {
          for (const [pattern, targets] of Object.entries(paths)) {
            if (!targets || targets.length === 0) continue;
            const prefix = pattern.replace(/\*$/, '');
            const target = targets[0].replace(/\*$/, '');
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
 * Recursively load a tsconfig and merge `compilerOptions.paths` /
 * `compilerOptions.baseUrl` from `extends` parents. Capped at 5 levels.
 * Child paths win on conflict.
 *
 * @param {string} configPath
 * @param {number} depth
 * @returns {object|null}
 */
export function loadTsconfigWithExtends(configPath, depth = 0) {
  if (depth > 5) return null;
  const content = readFileSafe(configPath);
  if (!content) return null;

  let config;
  try {
    const stripped = content
      .replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (m, str) => str || '')
      .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
      .replace(/,\s*([\]}])/g, '$1');
    config = JSON.parse(stripped);
  } catch {
    return null;
  }

  const ext = config?.extends;
  if (!ext) return config;

  const configDir = dirname(configPath);
  const candidates = [];
  if (ext.startsWith('.')) {
    const candidate = resolve(configDir, ext);
    candidates.push(candidate);
    if (!extname(candidate)) candidates.push(candidate + '.json');
  } else {
    const nm = join(configDir, 'node_modules', ext);
    candidates.push(nm);
    if (!extname(nm)) candidates.push(nm + '.json');
  }

  let parent = null;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      parent = loadTsconfigWithExtends(candidate, depth + 1);
      if (parent) break;
    }
  }
  if (!parent) return config;

  return {
    ...parent,
    ...config,
    compilerOptions: {
      ...(parent.compilerOptions || {}),
      ...(config.compilerOptions || {}),
      paths: {
        ...(parent.compilerOptions?.paths || {}),
        ...(config.compilerOptions?.paths || {}),
      },
    },
  };
}

/**
 * Resolve an aliased import (e.g. `@/components/Button`) to a repo-relative
 * path. Tries the exact match, then known JS/TS extensions, then `/index`
 * variants.
 *
 * @param {string} repoPath
 * @param {string} specifier
 * @param {Array<{prefix: string, replacement: string}>} aliases
 * @returns {string|null}
 */
export function resolveAliasImport(repoPath, specifier, aliases) {
  for (const { prefix, replacement } of aliases) {
    if (!specifier.startsWith(prefix)) continue;

    const rest = specifier.slice(prefix.length);
    const targetBase = join(replacement, rest);

    if (extname(rest)) {
      if (existsSync(targetBase) && isInsideRepo(repoPath, targetBase)) {
        return relative(repoPath, targetBase);
      }
      continue;
    }

    for (const ext of ALIAS_RESOLUTION_EXTS) {
      const candidate = targetBase + ext;
      if (existsSync(candidate) && isInsideRepo(repoPath, candidate)) {
        return relative(repoPath, candidate);
      }
    }

    for (const ext of ALIAS_INDEX_EXTS) {
      const candidate = join(targetBase, 'index' + ext);
      if (existsSync(candidate) && isInsideRepo(repoPath, candidate)) {
        return relative(repoPath, candidate);
      }
    }
  }

  return null;
}

/**
 * Guard against malformed/malicious `tsconfig.json` `paths:` entries that
 * resolve outside the repo (e.g. `"@/*": ["../../../outside/*"]`). Graph
 * nodes for out-of-repo files corrupt cluster analysis and code-map output.
 */
function isInsideRepo(repoPath, candidate) {
  const rel = relative(repoPath, candidate);
  return !!rel && !rel.startsWith('..') && !rel.startsWith('/');
}

function readFileSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
