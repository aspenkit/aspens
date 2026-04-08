import { resolve } from 'path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { analyzeImpact } from '../lib/impact.js';

export async function docImpactCommand(path, options) {
  const repoPath = resolve(path);

  p.intro(pc.cyan('aspens doc impact'));

  const spinner = p.spinner();
  spinner.start('Inspecting repo context coverage...');
  const report = await analyzeImpact(repoPath, options);
  spinner.stop(pc.green('Impact report ready'));

  console.log();
  console.log(pc.dim('  Repo: ') + pc.bold(report.scan.name));
  console.log(pc.dim('  Summary: ') + `${report.summary.repoStatus}, ${report.summary.changedFiles} changed file(s), ${report.summary.affectedTargets} target(s) affected`);
  console.log(pc.dim('  Context health: ') + scoreLabel(report.summary.averageHealth));
  console.log(pc.dim('  Latest source change: ') + formatDate(report.summary.latestSourceMtime));

  for (const target of report.targets) {
    console.log();
    console.log(pc.bold(`  ${target.label}`));
    console.log(pc.dim('    Context health: ') + scoreLabel(target.health));
    console.log(pc.dim('    Status: ') + [
      `instructions ${statusLabel(target.status.instructions)}`,
      `domains ${statusLabel(target.status.domains)}`,
      target.status.hooks !== 'n/a' ? `hooks ${statusLabel(target.status.hooks)}` : null,
    ].filter(Boolean).join(' | '));
    console.log(pc.dim('    Instructions: ') + `${target.instructionExists ? pc.green('present') : pc.yellow('missing')} (${target.instructionsFile})`);
    console.log(pc.dim('    Skills: ') + target.skillCount);

    if (target.domainCoverage.total > 0) {
      console.log(pc.dim('    Domain coverage: ') + `${target.domainCoverage.covered}/${target.domainCoverage.total}`);
      for (const detail of target.domainCoverage.details.slice(0, 5)) {
        console.log(pc.dim('      ') + `${detail.domain} ${detail.status === 'covered' ? pc.green('covered') : pc.yellow('missing')} ${pc.dim(`(${detail.reason})`)}`);
      }
      if (target.domainCoverage.details.length > 5) {
        console.log(pc.dim('      ...'));
      }
    } else {
      console.log(pc.dim('    Domain coverage: ') + pc.dim('n/a'));
    }

    if (target.hubCoverage.total > 0) {
      const missingHubs = target.hubCoverage.total - target.hubCoverage.mentioned;
      console.log(pc.dim('    Hub files surfaced: ') + `${target.hubCoverage.mentioned}/${target.hubCoverage.total}${missingHubs > 0 ? `, ${missingHubs} missing from root context` : ''}`);
    } else {
      console.log(pc.dim('    Hub files surfaced: ') + pc.dim('n/a'));
    }

    console.log(pc.dim('    Last generated: ') + (target.lastUpdated ? formatDate(target.lastUpdated) : pc.dim('not generated')));
    if (target.drift.changedCount > 0) {
      console.log(pc.dim('    Context drift: ') + `${target.drift.changedCount} source file(s) changed since last update`);
      if (target.drift.affectedDomains.length > 0) {
        console.log(pc.dim('      Affected domains: ') + target.drift.affectedDomains.join(', '));
      }
      for (const file of target.drift.changedFiles.slice(0, 4)) {
        console.log(pc.dim('      ') + file.path);
      }
      if (target.drift.changedFiles.length > 4) {
        console.log(pc.dim('      ...'));
      }
      if (target.drift.driftMs > 0) {
        console.log(pc.dim('      Drift window: ') + formatDuration(target.drift.driftMs));
      }
    } else {
      console.log(pc.dim('    Context drift: ') + pc.green('none detected'));
    }

    if (target.actions.length > 0) {
      console.log(pc.dim('    Recommended: ') + target.actions.map(action => `\`${action}\``).join(' • '));
    }
  }

  console.log();
  if (report.summary.actions.length === 0) {
    p.outro(pc.green('Context looks current'));
    return;
  }

  p.outro(pc.yellow(`Recommended next step: ${report.summary.actions.map(action => `\`${action}\``).join(' • ')}`));
}

function scoreLabel(score) {
  const color = score >= 85 ? pc.green : score >= 65 ? pc.yellow : pc.red;
  return color(`${score}/100`);
}

function statusLabel(status) {
  if (status === 'healthy') return pc.green(status);
  if (status === 'partial') return pc.yellow(status);
  if (status === 'n/a') return pc.dim(status);
  return pc.yellow(status);
}

function formatDate(timestamp) {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms) {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
