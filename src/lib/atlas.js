/**
 * Generate a compact Project Atlas markdown string from a serialized graph.
 * Designed to give LLMs a quick map of the codebase (~300-500 tokens).
 */

/**
 * Shorten a file path to its last 2 segments if it has 3+ segments.
 * e.g. "src/commands/doc-init.js" -> "commands/doc-init.js"
 */
function shortPath(filePath) {
  const parts = filePath.split('/');
  return parts.length >= 3 ? parts.slice(-2).join('/') : filePath;
}

/**
 * @param {object} graph - Serialized graph (from serializeGraph / graph.json)
 * @param {object} [options]
 * @param {Array<{name: string, path: string, description: string}>} [options.skills] - Skills to link to clusters
 * @param {number} [options.maxHubs] - Max hub files to show (default 5)
 * @param {number} [options.maxHotspots] - Max hotspots to show (default 3)
 * @returns {string} Compact markdown atlas
 */
export function generateAtlas(graph, options = {}) {
  const { skills = [], maxHubs = 5, maxHotspots = 3 } = options;

  const lines = [];
  lines.push('## Project Atlas');
  lines.push('');

  // --- Hub files ---
  const hubs = (graph.hubs || [])
    .slice()
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, maxHubs);

  if (hubs.length > 0) {
    lines.push('**Hub files:**');
    for (const hub of hubs) {
      // Use es-module-lexer exports if available, fall back to symbol definitions
      let symbolNames = (hub.exports || []).slice(0, 5);
      if (symbolNames.length === 0) {
        const fileDefs = graph.files?.[hub.path]?.definitions;
        if (fileDefs && fileDefs.length > 0) {
          symbolNames = fileDefs
            .filter(d => d.type === 'function' || d.type === 'type' || d.type === 'class')
            .slice(0, 5)
            .map(d => d.name);
        }
      }
      const symbolStr = symbolNames.join(', ');
      lines.push(`- \`${hub.path}\` — ${hub.fanIn} dependents${symbolStr ? ' | ' + symbolStr : ''}`);
    }
    lines.push('');
  }

  // --- Domains (clusters) ---
  const multiClusters = (graph.clusters || []).filter(c => c.size > 1);
  if (multiClusters.length > 0) {
    lines.push('**Domains:**');
    for (const cluster of multiClusters) {
      // Sort files by priority (highest first), take top 3, use short basenames
      const sortedFiles = cluster.files
        .slice()
        .sort((a, b) => {
          const pa = graph.files[a]?.priority ?? 0;
          const pb = graph.files[b]?.priority ?? 0;
          return pb - pa;
        })
        .slice(0, 3)
        .map(f => `\`${shortPath(f)}\``);

      let line = `- **${cluster.label}** (${cluster.size} files): ${sortedFiles.join(', ')}`;

      // Link matching skill
      const matchingSkill = skills.find(s => s.name === cluster.label);
      if (matchingSkill) {
        line += ` — [skill](${matchingSkill.path})`;
      }

      lines.push(line);
    }
    lines.push('');
  }

  // --- Hotspots ---
  const hotspots = (graph.hotspots || []).slice(0, maxHotspots);
  if (hotspots.length > 0) {
    lines.push('**Hotspots:**');
    for (const hs of hotspots) {
      lines.push(`- \`${hs.path}\` — ${hs.churn} changes, ${hs.lines} lines`);
    }
    lines.push('');
  }

  // --- Footer ---
  const totalFiles = graph.meta?.totalFiles ?? Object.keys(graph.files || {}).length;
  const totalEdges = graph.meta?.totalEdges ?? 0;
  const date = graph.meta?.generatedAt
    ? graph.meta.generatedAt.split('T')[0]
    : new Date().toISOString().split('T')[0];

  lines.push(`*${totalFiles} files, ${totalEdges} edges — ${date}*`);

  return lines.join('\n');
}
