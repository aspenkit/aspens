import { resolve } from 'path';
import pc from 'picocolors';
import { scanRepo } from '../lib/scanner.js';
import { buildRepoGraph } from '../lib/graph-builder.js';

function parseDomains(domainsStr) {
  if (!domainsStr) return undefined;
  return domainsStr.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

export async function scanCommand(path, options) {
  const repoPath = resolve(path);
  const extraDomains = parseDomains(options.domains);
  const result = scanRepo(repoPath, { extraDomains });

  // Build import graph
  if (options.graph !== false) {
    try {
      const graph = await buildRepoGraph(repoPath, result.languages);
      result.graph = formatGraphForDisplay(graph);
    } catch (err) {
      // Graph building failed — continue without it
      if (options.verbose) {
        console.error(pc.dim(`  Graph building failed: ${err.message}`));
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Pretty print
  console.log();
  console.log(pc.bold(`  ${result.name}`) + pc.dim(` (${result.repoType})`));
  console.log(pc.dim(`  ${result.path}`));
  console.log();

  if (result.languages.length > 0) {
    console.log(pc.cyan('  Languages: ') + result.languages.join(', '));
  }

  if (result.frameworks.length > 0) {
    console.log(pc.cyan('  Frameworks: ') + result.frameworks.join(', '));
  }

  if (result.entryPoints.length > 0) {
    console.log(pc.cyan('  Entry points: ') + result.entryPoints.join(', '));
  }

  console.log();

  if (result.structure.topDirs.length > 0) {
    console.log(pc.bold('  Structure'));
    const srcDir = result.structure.srcDir;
    for (const dir of result.structure.topDirs) {
      const marker = dir === srcDir ? pc.green(' ← source root') : '';
      console.log(pc.dim('    ') + dir + '/' + marker);
    }
    console.log();
  }

  if (Object.keys(result.structure.keyDirs).length > 0) {
    console.log(pc.bold('  Key directories'));
    for (const [role, dir] of Object.entries(result.structure.keyDirs)) {
      console.log(pc.dim('    ') + pc.yellow(role) + pc.dim(' → ') + dir + '/');
    }
    console.log();
  }

  if (result.graph) {
    // Import Graph section
    console.log(pc.bold('  Import Graph') + pc.dim(` (${pc.cyan(result.graph.fileCount)} files, ${pc.cyan(result.graph.edgeCount)} edges)`));
    if (result.graph.hubFiles && result.graph.hubFiles.length > 0) {
      console.log(pc.dim('    Hub files:'));
      const hubs = result.graph.hubFiles.slice(0, 5);
      // Find longest path for alignment
      const maxPath = Math.max(...hubs.map(h => h.path.length));
      for (const hub of hubs) {
        const padded = hub.path.padEnd(maxPath);
        const exportLabel = hub.exports === 1 ? 'export' : 'exports';
        const depLabel = hub.fanIn === 1 ? 'dependent' : 'dependents';
        console.log(pc.dim('      ') + pc.green(padded) + pc.dim(` \u2190 ${pc.cyan(String(hub.fanIn))} ${depLabel}, ${pc.cyan(String(hub.exports))} ${exportLabel}`));
      }
    }
    console.log();

    // Domains (by imports) section
    if (result.graph.domains && result.graph.domains.length > 0) {
      // Build reverse dependency map from coupling data
      const dependedOnBy = {};
      if (result.graph.coupling) {
        for (const c of result.graph.coupling) {
          if (!dependedOnBy[c.to]) dependedOnBy[c.to] = [];
          dependedOnBy[c.to].push(c.from);
        }
      }

      console.log(pc.bold('  Domains') + pc.dim(' (by imports)'));
      for (const domain of result.graph.domains) {
        const dirSuffix = domain.directory ? `${domain.directory}/` : '';
        console.log(pc.dim('    ') + pc.green(domain.name) + pc.dim(` (${dirSuffix})`) + pc.dim(` \u2014 ${pc.cyan(String(domain.sourceFileCount))} files`));

        // Module list
        if (domain.modules && domain.modules.length > 0) {
          const mods = domain.modules.slice(0, 8);
          const extra = domain.modules.length > 8 ? `, +${domain.modules.length - 8} more` : '';
          console.log(pc.dim('      ') + mods.join(', ') + pc.dim(extra));
        }

        // Depends on
        if (domain.importsFrom && domain.importsFrom.length > 0) {
          console.log(pc.dim('      \u2192 depends on: ') + domain.importsFrom.join(', '));
        }

        // Depended on by (reverse lookup)
        if (dependedOnBy[domain.name] && dependedOnBy[domain.name].length > 0) {
          console.log(pc.dim('      \u2190 depended on by: ') + dependedOnBy[domain.name].join(', '));
        }
      }
      console.log();
    } else if (result.domains && result.domains.length > 0) {
      // No graph-derived domains (e.g. C#/Java/Swift — graph-builder parses
      // JS/TS/Python only). Fall back to scanner's filesystem domains so
      // users don't see an empty section for non-JS projects.
      console.log(pc.bold('  Domains') + pc.dim(' (by filesystem)'));
      for (const domain of result.domains) {
        const dir = domain.directories && domain.directories[0] ? `${domain.directories[0]}/` : '';
        const count = domain.sourceFileCount ?? (domain.modules ? domain.modules.length : 0);
        console.log(pc.dim('    ') + pc.green(domain.name) + pc.dim(` (${dir})`) + pc.dim(` \u2014 ${pc.cyan(String(count))} files`));
        if (domain.modules && domain.modules.length > 0) {
          const mods = domain.modules.slice(0, 8);
          const extra = domain.modules.length > 8 ? `, +${domain.modules.length - 8} more` : '';
          console.log(pc.dim('      ') + mods.join(', ') + pc.dim(extra));
        }
      }
      console.log();
    }

    // Coupling section
    if (result.graph.coupling && result.graph.coupling.length > 0) {
      console.log(pc.bold('  Coupling'));
      const sorted = [...result.graph.coupling].sort((a, b) => b.count - a.count);
      // Find longest "from → to" string for alignment
      const labels = sorted.map(c => `${c.from} \u2192 ${c.to}`);
      const maxLabel = Math.max(...labels.map(l => l.length));
      for (let i = 0; i < sorted.length; i++) {
        const padded = labels[i].padEnd(maxLabel);
        console.log(pc.dim('    ') + padded + '  ' + pc.dim(`${pc.cyan(String(sorted[i].count))} imports`));
      }
      console.log();
    }

    // Hotspots section
    if (result.graph.hotspots && result.graph.hotspots.length > 0) {
      console.log(pc.bold('  Hotspots') + pc.dim(' (high churn, last 6 months)'));
      for (const h of result.graph.hotspots) {
        console.log(pc.dim('    ') + pc.yellow(h.path) + pc.dim(` — ${pc.cyan(String(h.churn))} changes, ${h.lines} lines`));
      }
      console.log();
    }
  } else if (result.domains.length > 0) {
    // Fallback: show detected domains without graph data
    console.log(pc.bold('  Detected domains'));
    for (const domain of result.domains) {
      const dir = domain.directories[0] || '';
      const mods = (domain.modules || []).slice(0, 6);
      const extra = (domain.modules || []).length > 6 ? ` +${domain.modules.length - 6} more` : '';
      const modStr = mods.length > 0 ? pc.dim(` \u2014 ${mods.join(', ')}${extra}`) : '';
      console.log(pc.dim('    ') + pc.green(domain.name) + pc.dim(` (${dir})`) + modStr);
    }
    console.log();
  }

  // Size
  if (result.size) {
    console.log(pc.bold('  Repo size'));
    console.log(pc.dim('    ') + `${result.size.sourceFiles} source files (~${result.size.estimatedLines.toLocaleString()} lines) \u2014 ${result.size.category}`);
    console.log();
  }

  // Health
  if (result.health && result.health.issues.length > 0) {
    console.log(pc.bold('  Health'));
    for (const issue of result.health.issues) {
      const icon = issue.level === 'warn' ? pc.yellow('⚠') : pc.blue('ℹ');
      console.log(`    ${icon} ${pc.yellow(issue.message)}`);
      if (issue.detail) {
        console.log(pc.dim(`      ${issue.detail}`));
      }
      console.log(pc.dim(`      Fix: ${issue.fix}`));
    }
    console.log();
  }

  // Status
  const claude = result.hasClaudeConfig ? pc.green('yes') : pc.dim('no');
  const claudeMd = result.hasClaudeMd ? pc.green('yes') : pc.dim('no');
  console.log(pc.bold('  Claude Code'));
  console.log(pc.dim('    ') + `.claude/ ${claude}  CLAUDE.md ${claudeMd}`);
  console.log();
}

/**
 * Transform raw graph builder output into the shape the display expects.
 */
function formatGraphForDisplay(graph) {
  const { files, hubs, clusters, hotspots, stats } = graph;

  // Format hub files
  const hubFiles = hubs.map(h => ({
    path: h.path,
    fanIn: h.fanIn,
    fanOut: h.fanOut,
    exports: Array.isArray(h.exports) ? h.exports.length : (h.exports || 0),
    lines: files[h.path]?.lines || 0,
  }));

  // Format domains from clusters — merge small components by parent directory
  const SKIP_STEMS = new Set(['__init__', 'index', 'mod']);
  const rawComponents = clusters.components || [];

  // Group files by their parent directory (e.g. src/backtest, tests/)
  const dirGroups = {};
  for (const comp of rawComponents) {
    for (const filePath of comp.files) {
      const parts = filePath.split('/');
      // For files directly in a top-level dir (tests/foo.py), use that dir
      // For deeper files (src/backtest/engine.py), use first two segments
      let dir;
      if (parts.length <= 2) {
        dir = parts[0]; // e.g. "tests" for "tests/test_foo.py"
      } else {
        dir = parts.slice(0, 2).join('/'); // e.g. "src/backtest"
      }
      if (!dirGroups[dir]) dirGroups[dir] = { files: [], label: dir };
      dirGroups[dir].files.push(filePath);
    }
  }

  const domains = Object.values(dirGroups)
    .filter(group => {
      // Skip groups that are just __init__.py files with no real modules
      const realFiles = group.files.filter(f => {
        const stem = f.split('/').pop().replace(/\.[^.]+$/, '');
        return !SKIP_STEMS.has(stem);
      });
      return realFiles.length > 0;
    })
    .map(group => {
      const modules = group.files.map(f => {
        const stem = f.split('/').pop().replace(/\.[^.]+$/, '');
        return SKIP_STEMS.has(stem) ? null : stem;
      }).filter(Boolean);

      const name = group.label.split('/').pop() || group.label;

      // Find imports from other directories
      const importsFrom = new Set();
      for (const filePath of group.files) {
        const fileInfo = files[filePath];
        if (!fileInfo) continue;
        for (const imp of (fileInfo.imports || [])) {
          const impParts = imp.split('/');
          const impDir = impParts.length > 2 ? impParts.slice(0, 2).join('/') : impParts[0];
          if (impDir !== group.label) {
            importsFrom.add(impDir.split('/').pop() || impDir);
          }
        }
      }

      return {
        name,
        directory: group.label,
        files: group.files,
        modules,
        sourceFileCount: group.files.length,
        importsFrom: [...importsFrom],
      };
    })
    .sort((a, b) => b.sourceFileCount - a.sourceFileCount);

  // Format coupling
  const coupling = (clusters.coupling || []).map(c => ({
    from: c.from,
    to: c.to,
    count: c.edges,
  }));

  return {
    fileCount: stats.totalFiles,
    edgeCount: stats.totalEdges,
    hubFiles,
    domains,
    coupling,
    hotspots: (hotspots || []).slice(0, 5),
  };
}
