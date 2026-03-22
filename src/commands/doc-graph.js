import { resolve } from 'path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { persistGraphArtifacts } from '../lib/graph-persistence.js';
import { CliError } from '../lib/errors.js';

export async function docGraphCommand(path, options) {
  const repoPath = resolve(path);

  p.intro(pc.cyan('aspens doc graph'));

  const spinner = p.spinner();
  spinner.start('Scanning repository...');

  const scan = scanRepo(repoPath);
  spinner.message('Building import graph...');

  let repoGraph;
  try {
    repoGraph = await buildRepoGraph(repoPath, scan.languages);
  } catch (err) {
    spinner.stop(pc.red('Graph build failed'));
    throw new CliError(`Failed to build import graph: ${err.message}`);
  }

  try {
    persistGraphArtifacts(repoPath, repoGraph);
  } catch (err) {
    spinner.stop(pc.red('Failed to save graph'));
    throw new CliError(`Failed to persist graph artifacts: ${err.message}`);
  }

  spinner.stop(pc.green('Graph saved'));

  // Print stats
  console.log();
  console.log(pc.dim('  Files:    ') + repoGraph.stats.totalFiles);
  console.log(pc.dim('  Edges:    ') + repoGraph.stats.totalEdges);
  console.log(pc.dim('  Hubs:     ') + repoGraph.hubs.length);
  console.log(pc.dim('  Clusters: ') + repoGraph.clusters.components.length);
  console.log(pc.dim('  Hotspots: ') + repoGraph.hotspots.length);
  console.log();

  if (options.verbose && repoGraph.hubs.length > 0) {
    console.log(pc.bold('  Top hubs:'));
    for (const hub of repoGraph.hubs.slice(0, 10)) {
      console.log(`    ${pc.cyan(hub.path)} — ${hub.fanIn} dependents`);
    }
    console.log();
  }

  p.outro(pc.dim('Saved to .claude/graph.json + .claude/skills/code-map/skill.md'));
}
