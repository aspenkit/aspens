#!/usr/bin/env node
/**
 * Graph Context Prompt Hook — Smart Matching Engine
 *
 * Standalone ESM module. Copied into target repo's .claude/hooks/ directory.
 * No imports from aspens — uses only Node.js builtins.
 *
 * Called by graph-context-prompt.sh on every UserPromptSubmit.
 * Uses a tiny pre-computed index (.claude/graph-index.json, ~1-3KB) for
 * fast matching against export names, hub filenames, and cluster labels.
 * Only loads the full graph (.claude/graph.json) when a match is found.
 *
 * Exports functions for testability (vitest can import them).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Index loading — tiny file (~1-3KB), safe to load on every prompt
// ---------------------------------------------------------------------------

/**
 * Load .claude/graph-index.json from the project directory.
 * @param {string} projectDir - Absolute path to the project root
 * @returns {Object|null} { exports, hubBasenames, clusterLabels } or null
 */
export function loadGraphIndex(projectDir) {
  const indexPath = join(projectDir, '.claude', 'graph-index.json');
  if (!existsSync(indexPath)) return null;
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Index-based prompt matching — fast, no full graph needed
// ---------------------------------------------------------------------------

/**
 * Match prompt against the pre-computed index.
 * Returns file paths that should be looked up in the full graph.
 *
 * Matching tiers:
 *  1. Explicit file paths (src/lib/scanner.js)
 *  2. Bare filenames matching hub basenames (scanner.js)
 *  3. Export/function names (scanRepo, buildRepoGraph)
 *  4. Cluster/directory label keywords
 *
 * @param {string} prompt - User prompt text
 * @param {Object} index - Loaded graph-index.json
 * @returns {string[]} File paths to look up in full graph (empty = no match)
 */
export function matchPromptAgainstIndex(prompt, index) {
  const matches = new Set();

  // Tier 1: Explicit repo-relative paths — check against hub basenames for validation
  const pathRe = /(?:^|\s|['"`(])(([\w@.~-]+\/)+[\w.-]+\.\w{1,5})(?:\s|['"`),:]|$)/g;
  let m;
  while ((m = pathRe.exec(prompt)) !== null) {
    const candidate = m[1].replace(/^\.\//, '');
    // We can't fully validate without the full graph, but any path-like string is worth looking up
    matches.add(candidate);
  }

  // Tier 2: Bare filenames matching hub basenames (index values are arrays)
  const bareRe = /\b([\w.-]+\.(js|ts|tsx|jsx|py|go|rs|rb))\b/g;
  while ((m = bareRe.exec(prompt)) !== null) {
    const filename = m[1];
    const hubPaths = index.hubBasenames[filename];
    if (hubPaths) {
      for (const p of (Array.isArray(hubPaths) ? hubPaths : [hubPaths])) matches.add(p);
    }
  }

  // Tier 3: Export/function names — only match code-shaped identifiers
  // Must look like code: camelCase, PascalCase, snake_case, or backtick-wrapped
  const codeIdentRe = /`(\w{3,})`|\b([a-z]+[A-Z]\w*|[A-Z][a-z]+[A-Z]\w*|\w+_\w+)\b/g;
  while ((m = codeIdentRe.exec(prompt)) !== null) {
    const word = m[1] || m[2]; // m[1] = backtick-wrapped, m[2] = code-shaped
    const exportPaths = word && index.exports[word];
    if (exportPaths) {
      for (const p of (Array.isArray(exportPaths) ? exportPaths : [exportPaths])) matches.add(p);
    }
  }

  // Tier 4: Cluster labels — only if no matches yet
  if (matches.size === 0 && index.clusterLabels) {
    const words = prompt.toLowerCase().split(/\s+/);
    for (const label of index.clusterLabels) {
      // Only match cluster labels that are specific enough (3+ chars, not generic)
      if (label.length >= 3 && words.includes(label.toLowerCase())) {
        matches.add(`__cluster__:${label}`);
      }
    }
  }

  return [...matches];
}

// ---------------------------------------------------------------------------
// Full graph loading (only when index match found)
// ---------------------------------------------------------------------------

/**
 * Load .claude/graph.json from the project directory.
 * @param {string} projectDir
 * @returns {Object|null}
 */
export function loadGraphJson(projectDir) {
  const graphPath = join(projectDir, '.claude', 'graph.json');
  if (!existsSync(graphPath)) return null;
  try {
    const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
    if (!graph.files || typeof graph.files !== 'object') return null;
    return graph;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve index matches to actual file paths in the full graph
// ---------------------------------------------------------------------------

/**
 * Resolve index match results against the full graph.
 * Handles cluster matches (expand to top files) and validates paths.
 *
 * @param {string[]} indexMatches - Output of matchPromptAgainstIndex
 * @param {Object} graph - Full parsed graph.json
 * @returns {string[]} Validated file paths
 */
export function resolveMatches(indexMatches, graph) {
  const resolved = new Set();

  for (const match of indexMatches) {
    // Cluster match — expand to top files in that cluster
    if (match.startsWith('__cluster__:')) {
      const label = match.slice('__cluster__:'.length);
      const idx = graph.clusterIndex?.[label];
      if (idx !== undefined && graph.clusters?.[idx]) {
        const cluster = graph.clusters[idx];
        const topFiles = cluster.files
          .filter(f => graph.files[f])
          .sort((a, b) => (graph.files[b].priority || 0) - (graph.files[a].priority || 0))
          .slice(0, 3);
        for (const f of topFiles) resolved.add(f);
      }
      continue;
    }

    // Direct file path — validate against graph
    if (graph.files[match]) {
      resolved.add(match);
      continue;
    }

    // Try matching as a suffix (user wrote partial path)
    const graphFiles = Object.keys(graph.files);
    for (const gf of graphFiles) {
      if (gf.endsWith('/' + match) || gf === match) {
        resolved.add(gf);
        break;
      }
    }
  }

  return [...resolved];
}

// ---------------------------------------------------------------------------
// Subgraph extraction — 1-hop neighborhood
// ---------------------------------------------------------------------------

const MAX_NEIGHBORS = 10;
const MAX_HUBS = 5;
const MAX_HOTSPOTS = 3;

/**
 * Extract neighborhood of mentioned files from the graph.
 */
export function buildNeighborhood(graph, filePaths) {
  const mentioned = new Set(filePaths);
  const neighborSet = new Set();

  for (const fp of filePaths) {
    const info = graph.files[fp];
    if (!info) continue;
    const allNeighbors = [...(info.imports || []), ...(info.importedBy || [])];
    const sorted = allNeighbors
      .filter(n => graph.files[n] && !mentioned.has(n))
      .sort((a, b) => (graph.files[b].priority || 0) - (graph.files[a].priority || 0))
      .slice(0, MAX_NEIGHBORS);
    for (const n of sorted) neighborSet.add(n);
  }

  const mentionedClusters = new Set();
  for (const fp of filePaths) {
    const info = graph.files[fp];
    if (info?.cluster) mentionedClusters.add(info.cluster);
  }

  const hubs = (graph.hubs || [])
    .filter(h => {
      const info = graph.files[h.path];
      if (!info) return false;
      return mentionedClusters.has(info.cluster) || mentioned.has(h.path) || neighborSet.has(h.path);
    })
    .slice(0, MAX_HUBS);

  const hotspots = (graph.hotspots || [])
    .filter(h => {
      const info = graph.files[h.path];
      if (!info) return false;
      return mentioned.has(h.path) || mentionedClusters.has(info.cluster);
    })
    .slice(0, MAX_HOTSPOTS);

  const clusters = [];
  for (const label of mentionedClusters) {
    const idx = graph.clusterIndex?.[label];
    if (idx !== undefined && graph.clusters?.[idx]) {
      clusters.push({ label: graph.clusters[idx].label, size: graph.clusters[idx].size });
    }
  }

  const coupling = (graph.coupling || [])
    .filter(c => mentionedClusters.has(c.from) || mentionedClusters.has(c.to))
    .slice(0, 5);

  return {
    mentionedFiles: filePaths
      .filter(fp => graph.files[fp])
      .map(fp => ({ path: fp, ...graph.files[fp] })),
    neighbors: [...neighborSet].map(fp => ({ path: fp, ...graph.files[fp] })),
    hubs,
    hotspots,
    clusters,
    coupling,
  };
}

// ---------------------------------------------------------------------------
// Format navigation context as compact markdown
// ---------------------------------------------------------------------------

function shortPath(p) {
  const parts = p.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

/**
 * Format neighborhood as compact markdown for context injection.
 */
export function formatNavContext(neighborhood) {
  if (!neighborhood || neighborhood.mentionedFiles.length === 0) return '';

  const lines = ['## Code Navigation\n'];

  lines.push('**Referenced files:**');
  for (const f of neighborhood.mentionedFiles.slice(0, 10)) {
    const hubTag = f.fanIn >= 3 ? `, hub: ${f.fanIn} dependents` : '';
    const imports = (f.imports || []).slice(0, 5).map(shortPath).join(', ');
    const importedBy = (f.importedBy || []).slice(0, 5).map(shortPath).join(', ');
    let detail = '';
    if (imports) detail += `imports: ${imports}`;
    if (importedBy) detail += `${detail ? '; ' : ''}imported by: ${importedBy}`;
    lines.push(`- \`${f.path}\` (${f.lines} lines${hubTag})${detail ? ' \u2014 ' + detail : ''}`);
  }
  lines.push('');

  const nonMentionedHubs = neighborhood.hubs.filter(
    h => !neighborhood.mentionedFiles.some(mf => mf.path === h.path)
  );
  if (nonMentionedHubs.length > 0) {
    lines.push('**Hubs (read first):**');
    for (const h of nonMentionedHubs) {
      const exports = (h.exports || []).slice(0, 5).join(', ');
      lines.push(`- \`${h.path}\` \u2014 ${h.fanIn} dependents${exports ? ', exports: ' + exports : ''}`);
    }
    lines.push('');
  }

  if (neighborhood.clusters.length > 0) {
    const clusterStr = neighborhood.clusters.map(c => `${c.label} (${c.size} files)`).join(', ');
    let line = `**Cluster:** ${clusterStr}`;
    if (neighborhood.coupling && neighborhood.coupling.length > 0) {
      const couplingStr = neighborhood.coupling
        .slice(0, 3)
        .map(c => `${c.from} \u2192 ${c.to} (${c.edges})`)
        .join(', ');
      line += ` | Cross-dep: ${couplingStr}`;
    }
    lines.push(line);
    lines.push('');
  }

  if (neighborhood.hotspots.length > 0) {
    lines.push('**Hotspots (high churn):**');
    for (const h of neighborhood.hotspots) {
      lines.push(`- \`${h.path}\` \u2014 ${h.churn} changes, ${h.lines} lines`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  try {
    const input = readFileSync(0, 'utf-8');

    let data;
    try {
      data = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const prompt = data.prompt || '';
    if (!prompt) {
      process.exit(0);
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (!projectDir) {
      process.exit(0);
    }

    // Step 1: Always load code-map overview (~1ms)
    const codeMapPath = join(projectDir, '.claude', 'code-map.md');
    let codeMap = '';
    if (existsSync(codeMapPath)) {
      try {
        codeMap = readFileSync(codeMapPath, 'utf-8');
      } catch { /* ignore */ }
    }

    // If no code-map exists, nothing to do
    if (!codeMap) {
      process.exit(0);
    }

    // Step 2: Try to enrich with detailed neighborhood (best-effort)
    let detailedContext = '';
    let debugInfo = null;
    try {
      const index = loadGraphIndex(projectDir);
      if (index) {
        const indexMatches = matchPromptAgainstIndex(prompt, index);
        if (indexMatches.length > 0) {
          const graph = loadGraphJson(projectDir);
          if (graph) {
            const filePaths = resolveMatches(indexMatches, graph);
            if (filePaths.length > 0) {
              const neighborhood = buildNeighborhood(graph, filePaths);
              detailedContext = formatNavContext(neighborhood);
              debugInfo = { indexMatches, filePaths, neighborhoodSize: neighborhood.mentionedFiles.length + neighborhood.neighbors.length };
            }
          }
        }
      }
    } catch { /* matching failed — still emit code-map */ }

    // Debug output
    if (process.env.ASPENS_DEBUG === '1' && debugInfo) {
      try {
        const { writeFileSync: wfs } = await import('fs');
        wfs('/tmp/aspens-debug-graph-context.json', JSON.stringify({
          timestamp: new Date().toISOString(),
          projectDir,
          prompt: prompt.substring(0, 500),
          ...debugInfo,
        }, null, 2));
      } catch { /* ignore */ }
    }

    // Emit: always code-map, optionally detailed neighborhood
    let output = '<!-- graph-context -->\n';
    output += codeMap;
    if (detailedContext) output += '\n' + detailedContext;
    output += '<!-- /graph-context -->\n';
    process.stdout.write(output);

    if (detailedContext) {
      process.stderr.write(`[Graph] Code map + ${debugInfo.filePaths.length} matched files\n`);
    } else {
      process.stderr.write('[Graph] Code map loaded\n');
    }

    process.exit(0);
  } catch (err) {
    // NEVER block the user's prompt
    process.stderr.write(`[Graph] Error: ${err.message}\n`);
    process.exit(0);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
