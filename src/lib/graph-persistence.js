import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { generateAtlas } from './atlas.js';

const GRAPH_PATH = '.claude/graph.json';
const GRAPH_VERSION = '1.0';

/**
 * Convert raw buildRepoGraph() output to an indexed format optimized for
 * O(1) lookups. Adds meta block, per-file cluster field, cluster index.
 * Drops redundant edges/ranked/entryPoints arrays.
 */
export function serializeGraph(rawGraph, repoPath) {
  // Get git hash for cache metadata
  let gitHash = '';
  try {
    gitHash = execSync('git rev-parse --short HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* not a git repo or git unavailable */ }

  // Build file → cluster label mapping from clusters
  const fileToCluster = {};
  if (rawGraph.clusters?.components) {
    for (const comp of rawGraph.clusters.components) {
      for (const filePath of comp.files) {
        fileToCluster[filePath] = comp.label;
      }
    }
  }

  // Build indexed files map (drop externalImports to save space, add cluster)
  const files = {};
  for (const [path, info] of Object.entries(rawGraph.files)) {
    files[path] = {
      imports: info.imports,
      importedBy: info.importedBy,
      exports: info.exports,
      lines: info.lines,
      fanIn: info.fanIn,
      fanOut: info.fanOut,
      churn: info.churn,
      priority: Math.round(info.priority * 10) / 10,
      cluster: fileToCluster[path] || null,
    };
  }

  // Build cluster index for O(1) lookup
  const clusters = rawGraph.clusters?.components || [];
  const clusterIndex = {};
  for (let i = 0; i < clusters.length; i++) {
    clusterIndex[clusters[i].label] = i;
  }

  return {
    version: GRAPH_VERSION,
    meta: {
      generatedAt: new Date().toISOString(),
      gitHash,
      totalFiles: rawGraph.stats.totalFiles,
      totalEdges: rawGraph.stats.totalEdges,
    },
    files,
    hubs: rawGraph.hubs.map(h => ({
      path: h.path,
      fanIn: h.fanIn,
      exports: h.exports,
    })),
    clusters: clusters.map(c => ({
      label: c.label,
      size: c.size,
      files: c.files,
    })),
    coupling: rawGraph.clusters?.coupling || [],
    hotspots: rawGraph.hotspots,
    clusterIndex,
  };
}

/**
 * Write serialized graph to .claude/graph.json.
 */
export function saveGraph(repoPath, serializedGraph) {
  const graphDir = join(repoPath, '.claude');
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(
    join(repoPath, GRAPH_PATH),
    JSON.stringify(serializedGraph, null, 2) + '\n',
  );
}

/**
 * Load graph.json from disk. Returns null if missing or unparseable.
 */
export function loadGraph(repoPath) {
  const fullPath = join(repoPath, GRAPH_PATH);
  if (!existsSync(fullPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(fullPath, 'utf-8'));
    // Minimal structure validation
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.files || typeof parsed.files !== 'object') return null;
    if (!Array.isArray(parsed.hubs)) return null;
    if (!Array.isArray(parsed.clusters)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt → file reference extraction
// ---------------------------------------------------------------------------

/**
 * Extract file references from a user prompt, validated against graph keys.
 * Returns repo-relative file paths found in the graph.
 *
 * Tiered extraction:
 *  1. Explicit paths (src/lib/scanner.js)
 *  2. Bare filenames (scanner.js) — validated against graph keys
 *  3. Cluster/directory name keywords
 */
export function extractFileReferences(prompt, graph) {
  const graphFiles = Object.keys(graph.files);
  const matches = new Set();

  // Tier 1: Explicit repo-relative paths
  const pathRe = /(?:^|\s|['"`(])(([\w@.~-]+\/)+[\w.-]+\.\w{1,5})(?:\s|['"`),:]|$)/g;
  let m;
  while ((m = pathRe.exec(prompt)) !== null) {
    const candidate = m[1];
    // Direct match
    if (graph.files[candidate]) {
      matches.add(candidate);
      continue;
    }
    // Try without leading ./
    const stripped = candidate.replace(/^\.\//, '');
    if (graph.files[stripped]) {
      matches.add(stripped);
    }
  }

  // Tier 2: Bare filenames (e.g. "scanner.js") — match against graph keys
  const bareRe = /\b([\w.-]+\.(js|ts|tsx|jsx|py|go|rs|rb))\b/g;
  while ((m = bareRe.exec(prompt)) !== null) {
    const filename = m[1];
    for (const gf of graphFiles) {
      if (gf.endsWith('/' + filename) || gf === filename) {
        matches.add(gf);
      }
    }
  }

  // Tier 3: Cluster/directory keywords — only if no files matched yet
  if (matches.size === 0 && graph.clusterIndex) {
    const words = prompt.toLowerCase().split(/\s+/);
    for (const label of Object.keys(graph.clusterIndex)) {
      if (words.includes(label.toLowerCase())) {
        // Add top hub files from this cluster (up to 3)
        const clusterIdx = graph.clusterIndex[label];
        const cluster = graph.clusters[clusterIdx];
        if (cluster) {
          const clusterFiles = cluster.files
            .filter(f => graph.files[f])
            .sort((a, b) => (graph.files[b].priority || 0) - (graph.files[a].priority || 0))
            .slice(0, 3);
          for (const cf of clusterFiles) {
            matches.add(cf);
          }
        }
      }
    }
  }

  return [...matches];
}

// ---------------------------------------------------------------------------
// Subgraph extraction
// ---------------------------------------------------------------------------

const MAX_NEIGHBORS_PER_FILE = 10;
const MAX_HUBS = 5;
const MAX_HOTSPOTS = 3;

/**
 * Extract the neighborhood of mentioned files from the graph.
 * Returns: mentioned files + 1-hop neighbors, relevant hubs, hotspots, cluster info.
 *
 * Note: this logic is mirrored in graph-context-prompt.mjs::buildNeighborhood
 * (the hook is standalone with no aspens imports). Keep both in sync.
 */
export function extractSubgraph(graph, filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return { mentionedFiles: [], neighbors: [], hubs: [], hotspots: [], clusters: [] };
  }

  const mentioned = new Set(filePaths);
  const neighborSet = new Set();

  // Collect 1-hop neighbors (imports + importedBy)
  for (const fp of filePaths) {
    const info = graph.files[fp];
    if (!info) continue;

    const allNeighbors = [...(info.imports || []), ...(info.importedBy || [])];
    // Sort by priority (highest first), cap at MAX_NEIGHBORS_PER_FILE
    const sorted = allNeighbors
      .filter(n => graph.files[n] && !mentioned.has(n))
      .sort((a, b) => (graph.files[b].priority || 0) - (graph.files[a].priority || 0))
      .slice(0, MAX_NEIGHBORS_PER_FILE);

    for (const n of sorted) {
      neighborSet.add(n);
    }
  }

  // Find hubs relevant to mentioned files (same cluster or direct neighbor)
  const mentionedClusters = new Set();
  for (const fp of filePaths) {
    const info = graph.files[fp];
    if (info?.cluster) mentionedClusters.add(info.cluster);
  }

  const relevantHubs = (graph.hubs || [])
    .filter(h => {
      const info = graph.files[h.path];
      if (!info) return false;
      // Hub is in same cluster as a mentioned file, or is a direct neighbor
      return mentionedClusters.has(info.cluster) || mentioned.has(h.path) || neighborSet.has(h.path);
    })
    .slice(0, MAX_HUBS);

  // Find hotspots overlapping with mentioned files or their cluster
  const relevantHotspots = (graph.hotspots || [])
    .filter(h => {
      const info = graph.files[h.path];
      if (!info) return false;
      return mentioned.has(h.path) || mentionedClusters.has(info.cluster);
    })
    .slice(0, MAX_HOTSPOTS);

  // Cluster context
  const clusterContext = [];
  for (const label of mentionedClusters) {
    const idx = graph.clusterIndex?.[label];
    if (idx !== undefined && graph.clusters[idx]) {
      const cluster = graph.clusters[idx];
      clusterContext.push({ label: cluster.label, size: cluster.size });
    }
  }

  // Coupling for mentioned clusters
  const clusterCoupling = (graph.coupling || [])
    .filter(c => mentionedClusters.has(c.from) || mentionedClusters.has(c.to))
    .slice(0, 5);

  return {
    mentionedFiles: filePaths.map(fp => ({
      path: fp,
      ...graph.files[fp],
    })).filter(f => f.fanIn !== undefined),
    neighbors: [...neighborSet].map(fp => ({
      path: fp,
      ...graph.files[fp],
    })),
    hubs: relevantHubs,
    hotspots: relevantHotspots,
    clusters: clusterContext,
    coupling: clusterCoupling,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a subgraph extraction as compact markdown for context injection.
 * Respects a ~50 line budget.
 */
export function formatNavigationContext(subgraph) {
  if (!subgraph || subgraph.mentionedFiles.length === 0) return '';

  const lines = ['## Code Navigation\n'];

  // Referenced files with relationships
  lines.push('**Referenced files:**');
  for (const f of subgraph.mentionedFiles.slice(0, 10)) {
    const hubTag = f.fanIn >= 3 ? `, hub: ${f.fanIn} dependents` : '';
    const imports = (f.imports || []).slice(0, 5).map(shortPath).join(', ');
    const importedBy = (f.importedBy || []).slice(0, 5).map(shortPath).join(', ');
    let detail = '';
    if (imports) detail += `imports: ${imports}`;
    if (importedBy) detail += `${detail ? '; ' : ''}imported by: ${importedBy}`;
    lines.push(`- \`${f.path}\` (${f.lines} lines${hubTag})${detail ? ' — ' + detail : ''}`);
  }
  lines.push('');

  // Hubs in this area
  const nonMentionedHubs = subgraph.hubs.filter(
    h => !subgraph.mentionedFiles.some(mf => mf.path === h.path)
  );
  if (nonMentionedHubs.length > 0) {
    lines.push('**Hubs (read first):**');
    for (const h of nonMentionedHubs) {
      const exports = (h.exports || []).slice(0, 5).join(', ');
      lines.push(`- \`${h.path}\` — ${h.fanIn} dependents${exports ? ', exports: ' + exports : ''}`);
    }
    lines.push('');
  }

  // Cluster context
  if (subgraph.clusters.length > 0) {
    const clusterStr = subgraph.clusters.map(c => `${c.label} (${c.size} files)`).join(', ');
    let line = `**Cluster:** ${clusterStr}`;
    if (subgraph.coupling && subgraph.coupling.length > 0) {
      const couplingStr = subgraph.coupling
        .slice(0, 3)
        .map(c => `${c.from} → ${c.to} (${c.edges})`)
        .join(', ');
      line += ` | Cross-dep: ${couplingStr}`;
    }
    lines.push(line);
    lines.push('');
  }

  // Hotspots
  if (subgraph.hotspots.length > 0) {
    lines.push('**Hotspots (high churn):**');
    for (const h of subgraph.hotspots) {
      lines.push(`- \`${h.path}\` — ${h.churn} changes, ${h.lines} lines`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function shortPath(p) {
  // Return just filename if path has multiple segments
  const parts = p.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

// ---------------------------------------------------------------------------
// Code-map generation — standalone overview, independent of skills
// ---------------------------------------------------------------------------

const CODE_MAP_PATH = '.claude/code-map.md';
const MAX_MAP_HUBS = 10;
const MAX_MAP_HOTSPOTS = 5;

/**
 * Generate a standalone code-map overview from the serialized graph.
 * Written to .claude/code-map.md — loaded by the graph hook when it fires,
 * independent of the skill activation system.
 *
 * @param {Object} serializedGraph - Output of serializeGraph()
 * @returns {string} Markdown content for code-map.md
 */
export function generateCodeMap(serializedGraph) {
  const lines = ['## Codebase Structure\n'];

  // Hub files
  if (serializedGraph.hubs?.length > 0) {
    lines.push('**Hub files (most depended-on — prioritize reading these):**');
    for (const h of serializedGraph.hubs.slice(0, MAX_MAP_HUBS)) {
      const exports = (h.exports || []).slice(0, 6).join(', ');
      lines.push(`- \`${h.path}\` — ${h.fanIn} dependents${exports ? ' | exports: ' + exports : ''}`);
    }
    lines.push('');
  }

  // Domain clusters
  if (serializedGraph.clusters?.length > 0) {
    const multiFileClusters = serializedGraph.clusters.filter(c => c.size > 1);
    if (multiFileClusters.length > 0) {
      lines.push('**Domain clusters:**');
      for (const c of multiFileClusters) {
        const topFiles = c.files
          .filter(f => serializedGraph.files[f])
          .sort((a, b) => (serializedGraph.files[b].priority || 0) - (serializedGraph.files[a].priority || 0))
          .slice(0, 5)
          .map(f => `\`${shortPath(f)}\``)
          .join(', ');
        lines.push(`- **${c.label}** (${c.size} files): ${topFiles}`);
      }
      lines.push('');
    }
  }

  // Cross-domain coupling
  if (serializedGraph.coupling?.length > 0) {
    lines.push('**Cross-domain dependencies:**');
    for (const c of serializedGraph.coupling.slice(0, 5)) {
      lines.push(`- ${c.from} \u2192 ${c.to} (${c.edges} imports)`);
    }
    lines.push('');
  }

  // Hotspots
  if (serializedGraph.hotspots?.length > 0) {
    lines.push('**Hotspots (high churn):**');
    for (const h of serializedGraph.hotspots.slice(0, MAX_MAP_HOTSPOTS)) {
      lines.push(`- \`${h.path}\` — ${h.churn} changes, ${h.lines} lines`);
    }
    lines.push('');
  }

  lines.push(`*${serializedGraph.meta.totalFiles} files, ${serializedGraph.meta.totalEdges} edges — updated ${serializedGraph.meta.generatedAt.split('T')[0]}*`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Write code-map to .claude/code-map.md.
 */
export function writeCodeMap(repoPath, serializedGraph) {
  const content = generateCodeMap(serializedGraph);
  const dir = join(repoPath, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoPath, CODE_MAP_PATH), content);
}

// ---------------------------------------------------------------------------
// Atlas generation — compact project overview for LLM context
// ---------------------------------------------------------------------------

const ATLAS_PATH = '.claude/atlas.md';

/**
 * Write atlas.md to .claude/atlas.md.
 */
export function writeAtlas(repoPath, serializedGraph, options = {}) {
  const content = generateAtlas(serializedGraph, options);
  const dir = join(repoPath, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoPath, ATLAS_PATH), content);
  return content;
}

// ---------------------------------------------------------------------------
// Graph index — tiny pre-computed lookup for fast hook matching
// ---------------------------------------------------------------------------

const INDEX_PATH = '.claude/graph-index.json';

/**
 * Generate a tiny index (~1-3KB) for fast prompt matching in the hook.
 * Contains export names → file path, hub basenames, cluster labels.
 *
 * @param {Object} serializedGraph - Output of serializeGraph()
 * @returns {Object} The index object
 */
export function generateGraphIndex(serializedGraph) {
  // Export name → file paths (inverted index, array to handle duplicates)
  const exports = {};
  for (const [path, info] of Object.entries(serializedGraph.files)) {
    for (const exp of (info.exports || [])) {
      // Skip very short or generic exports (1-2 chars like 'x', 'a')
      if (exp.length > 2) {
        if (!exports[exp]) {
          exports[exp] = [path];
        } else {
          exports[exp].push(path);
        }
      }
    }
  }

  // Hub basenames → full paths (array to handle duplicates like src/utils.js + lib/utils.js)
  const hubBasenames = {};
  for (const h of (serializedGraph.hubs || [])) {
    const basename = h.path.split('/').pop();
    if (!hubBasenames[basename]) {
      hubBasenames[basename] = [h.path];
    } else {
      hubBasenames[basename].push(h.path);
    }
  }

  // Cluster labels
  const clusterLabels = Object.keys(serializedGraph.clusterIndex || {});

  return { exports, hubBasenames, clusterLabels };
}

/**
 * Write graph-index.json to .claude/graph-index.json.
 */
export function saveGraphIndex(repoPath, index) {
  const dir = join(repoPath, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(repoPath, INDEX_PATH),
    JSON.stringify(index) + '\n', // compact — no pretty-print for speed
  );
}

/**
 * Convenience: persist graph, code-map, and index in one call.
 * @param {string} repoPath
 * @param {object} rawGraph
 * @param {object} [options]
 * @param {object} [options.target] — target definition. If target.supportsGraph is false, returns serialized data without writing files.
 */
export function persistGraphArtifacts(repoPath, rawGraph, options = {}) {
  const target = options.target;
  const serialized = serializeGraph(rawGraph, repoPath);

  // If target doesn't support graph artifacts, return serialized data without writing
  if (target?.supportsGraph === false) {
    return serialized;
  }

  saveGraph(repoPath, serialized);
  writeCodeMap(repoPath, serialized);
  writeAtlas(repoPath, serialized, { skills: options.skills || [] });
  const index = generateGraphIndex(serialized);
  saveGraphIndex(repoPath, index);
  ensureGraphGitignore(repoPath);
  return serialized;
}

/**
 * Ensure .claude/graph artifacts are gitignored to prevent the post-commit
 * loop where graph.json's gitHash/timestamp changes every sync → new commit
 * → sync runs again → repeat.
 */
function ensureGraphGitignore(repoPath) {
  const gitignorePath = join(repoPath, '.gitignore');
  const entries = [
    '.claude/graph.json',
    '.claude/graph-index.json',
    '.claude/code-map.md',
    '.claude/atlas.md',
  ];

  let existing = '';
  try { existing = readFileSync(gitignorePath, 'utf8'); } catch { /* no .gitignore yet */ }

  const existingLines = new Set(existing.split('\n').map(l => l.trim()));
  const toAdd = entries.filter(e => !existingLines.has(e));
  if (toAdd.length === 0) return;

  const block = '\n# aspens graph artifacts (generated — do not commit)\n' + toAdd.join('\n') + '\n';
  writeFileSync(gitignorePath, existing + block, 'utf8');
}
