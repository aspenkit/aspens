import { resolve } from 'path';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { analyzeImpact, summarizeValueComparison } from '../lib/impact.js';
import { detectAvailableBackends, resolveBackend } from '../lib/backend.js';
import { loadPrompt, runLLM } from '../lib/runner.js';
import { docInitCommand } from './doc-init.js';
import { docSyncCommand } from './doc-sync.js';

export async function docImpactCommand(path, options) {
  const repoPath = resolve(path);

  p.intro(pc.cyan('aspens doc impact'));

  const spinner = p.spinner();
  spinner.start('Inspecting repo context coverage...');
  const report = await analyzeImpact(repoPath, options);
  const comparison = summarizeValueComparison(report.targets);
  spinner.stop(pc.green('Impact report ready'));

  console.log();
  console.log(pc.dim('  Repo: ') + pc.bold(report.scan.name));
  console.log(pc.dim('  Summary: ') + `${report.summary.repoStatus}, ${report.summary.changedFiles} changed file(s), ${report.summary.affectedTargets} target(s) affected`);
  console.log(pc.dim('  Context health: ') + scoreLabel(report.summary.averageHealth));
  console.log(pc.dim('  Latest source change: ') + formatDate(report.summary.latestSourceMtime));
  console.log(pc.dim('  Without aspens: ') + comparison.withoutAspens);
  console.log(pc.dim('  With aspens now: ') + comparison.withAspens);
  console.log(pc.dim('  Freshness: ') + comparison.freshness);
  console.log(pc.dim('  Automation: ') + comparison.automation);
  if (report.summary.missing.length > 0) {
    console.log(pc.dim('  What’s missing:'));
    for (const item of report.summary.missing.slice(0, 4)) {
      console.log(pc.dim('    ') + formatMissingItem(item));
    }
  }
  if (report.summary.opportunities?.length > 0) {
    console.log();
    console.log(pc.bold('  Missing Aspens Setup'));
    for (const item of report.summary.opportunities.slice(0, 4)) {
      console.log(pc.dim('    ') + `${item.message}: ${pc.cyan(item.command)}`);
    }
  }

  let analysis = null;
  const available = detectAvailableBackends();
  if (available.claude || available.codex) {
    const { backend, warning } = resolveBackend({
      backendFlag: options.backend,
      available,
    });
    if (warning) p.log.warn(warning);

    const analysisSpinner = p.spinner();
    analysisSpinner.start(`Analyzing impact with ${backend.label}...`);
    try {
      const prompt = buildImpactAnalysisPrompt(repoPath, report, comparison);
      const result = await runLLM(prompt, {
        timeout: (options.timeout || 300) * 1000,
        verbose: !!options.verbose,
        model: options.model || null,
        onActivity: options.verbose ? (msg) => analysisSpinner.message(pc.dim(msg)) : null,
        disableTools: true,
        cwd: repoPath,
      }, backend.id);
      analysis = parseAnalysis(result.text);
      analysisSpinner.stop(pc.green(`Analysis complete (${backend.label})`));
    } catch (err) {
      analysisSpinner.stop(pc.yellow('Analysis unavailable'));
      p.log.warn(err.message);
    }
  } else {
    p.log.warn('Impact interpretation unavailable: install Claude CLI or Codex CLI to enable it.');
  }

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

    if (target.usefulness.strengths.length > 0) {
      console.log(pc.dim('    Helpfulness: ') + target.usefulness.strengths[0]);
      for (const line of target.usefulness.strengths.slice(1, 3)) {
        console.log(pc.dim('      ') + line);
      }
    }

    if (target.usefulness.activationExamples.length > 0) {
      console.log(pc.dim('    Examples: '));
      for (const example of target.usefulness.activationExamples) {
        console.log(pc.dim('      ') + example);
      }
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

    if (target.hookHealth?.issues?.length > 0) {
      console.log(pc.dim('    Hook issues: '));
      for (const issue of target.hookHealth.issues.slice(0, 3)) {
        console.log(pc.dim('      ') + issue);
      }
    }

    if (target.saveTokensHealth?.configured) {
      console.log(pc.bold('    Save-tokens: ') + (target.saveTokensHealth.healthy ? pc.green('healthy') : pc.yellow('broken')));
      if (target.saveTokensHealth.healthy) {
        console.log(pc.dim('      ') + 'statusLine + prompt guard + precompact + handoff commands installed');
      } else {
        for (const issue of target.saveTokensHealth.issues.slice(0, 3)) {
          console.log(pc.dim('      ') + issue);
        }
      }
    }

    if (target.usefulness.blindSpots.length > 0) {
      console.log(pc.dim('    Blind spots: '));
      for (const blindSpot of target.usefulness.blindSpots.slice(0, 3)) {
        console.log(pc.dim('      ') + blindSpot);
      }
    }

    if (target.actions.length > 0) {
      console.log(pc.dim('    Recommended: ') + target.actions.map(action => `\`${action}\``).join(' • '));
    }
  }

  if (analysis) {
    console.log();
    console.log(pc.bold('  Interpretation'));
    renderAnalysis(analysis);
  }

  console.log();
  const applyPlan = buildApplyPlan(report.targets);

  if (applyPlan.length > 0) {
    const confirmApply = await p.confirm({
      message: buildApplyConfirmationMessage(),
      initialValue: true,
    });

    if (!p.isCancel(confirmApply) && confirmApply) {
      p.log.info(`Applying ${applyPlan.length} recommended action(s)...`);
      for (const item of applyPlan) {
        await applyRecommendedAction(repoPath, item.action, options, item.target);
      }
    }
  }

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

function formatMissingItem(item) {
  const color = item.severity === 'high' ? pc.red
    : item.severity === 'medium' ? pc.yellow
    : pc.dim;
  return color(item.message);
}

function buildImpactAnalysisPrompt(repoPath, report, comparison) {
  const payload = {
    repoPath,
    scan: {
      name: report.scan.name,
      repoType: report.scan.repoType,
      languages: report.scan.languages,
      frameworks: report.scan.frameworks,
      domains: report.scan.domains,
      size: report.scan.size,
    },
    summary: report.summary,
    comparison,
    targets: report.targets.map(target => ({
      id: target.id,
      label: target.label,
      instructionsFile: target.instructionsFile,
      instructionExists: target.instructionExists,
      skillCount: target.skillCount,
      hooksInstalled: target.hooksInstalled,
      saveTokensHealth: target.saveTokensHealth,
      lastUpdated: target.lastUpdated,
      health: target.health,
      status: target.status,
      domainCoverage: target.domainCoverage,
      hubCoverage: target.hubCoverage,
      drift: {
        changedCount: target.drift.changedCount,
        affectedDomains: target.drift.affectedDomains,
      },
      usefulness: target.usefulness,
      actions: target.actions,
    })),
  };

  return loadPrompt('impact-analyze') + '\n\n```json\n' + JSON.stringify(payload, null, 2) + '\n```';
}

function parseAnalysis(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Analysis returned invalid JSON.');
  }
  return {
    bottomLine: String(parsed.bottom_line || '').trim(),
    improves: Array.isArray(parsed.improves) ? parsed.improves.map(v => String(v).trim()).filter(Boolean) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(v => String(v).trim()).filter(Boolean) : [],
    nextStep: String(parsed.next_step || '').trim(),
  };
}

function renderAnalysis(analysis) {
  if (analysis.bottomLine) {
    console.log(pc.dim('    Summary: ') + analysis.bottomLine);
  }
  if (analysis.improves.length > 0) {
    console.log(pc.dim('    Helps:'));
    for (const item of analysis.improves.slice(0, 3)) {
      console.log(pc.dim('      - ') + item);
    }
  }
  if (analysis.risks.length > 0) {
    console.log(pc.dim('    Risks:'));
    for (const item of analysis.risks.slice(0, 3)) {
      console.log(pc.dim('      - ') + item);
    }
  }
  if (analysis.nextStep) {
    console.log(pc.dim('    Next: ') + analysis.nextStep);
  }
}

export function buildApplyPlan(targets) {
  const seen = new Set();
  const plan = [];

  for (const target of targets || []) {
    for (const action of target.actions || []) {
      const key = action === 'aspens doc sync'
        ? action
        : `${target.id}:${action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ action, target });
    }
  }

  return plan;
}

export function buildApplyConfirmationMessage() {
  return 'Do you want to apply recommendations?';
}

async function applyRecommendedAction(repoPath, action, options, target = null) {
  p.log.info(pc.dim(`Running: ${action}`));

  if (action === 'aspens doc sync') {
    await docSyncCommand(repoPath, {
      commits: 1,
      refresh: false,
      installHook: false,
      removeHook: false,
      dryRun: false,
      timeout: options.timeout || 300,
      model: options.model || null,
      verbose: !!options.verbose,
      graph: options.graph !== false,
    });
    return;
  }

  if (action === 'aspens doc init --hooks-only') {
    await docInitCommand(repoPath, {
      hooksOnly: true,
      dryRun: false,
      force: false,
      timeout: options.timeout || 300,
      mode: null,
      strategy: null,
      domains: null,
      model: options.model || null,
      hook: true,
      hooks: true,
      verbose: !!options.verbose,
      graph: options.graph !== false,
      target: target?.id || null,
      backend: options.backend || null,
      recommended: false,
    });
    return;
  }

  if (action === 'aspens doc init --recommended' || action === 'aspens doc init --recommended --strategy improve') {
    await docInitCommand(repoPath, {
      recommended: true,
      dryRun: false,
      force: false,
      timeout: options.timeout || 300,
      mode: null,
      strategy: action.includes('--strategy improve') ? 'improve' : null,
      domains: null,
      model: options.model || null,
      hook: true,
      hooks: true,
      verbose: !!options.verbose,
      graph: options.graph !== false,
      target: target?.id || null,
      backend: options.backend || null,
      hooksOnly: false,
    });
    return;
  }

  if (action === 'aspens doc init --mode base-only --strategy improve' || action === 'aspens doc init --mode base-only --strategy rewrite') {
    await docInitCommand(repoPath, {
      recommended: false,
      dryRun: false,
      force: false,
      timeout: options.timeout || 300,
      mode: 'base-only',
      strategy: action.includes('--strategy rewrite') ? 'rewrite' : 'improve',
      domains: null,
      model: options.model || null,
      hook: true,
      hooks: true,
      verbose: !!options.verbose,
      graph: options.graph !== false,
      target: target?.id || null,
      backend: options.backend || null,
      hooksOnly: false,
    });
    return;
  }

  const domainMatch = action.match(/^aspens doc init --mode chunked --domains (.+)$/);
  if (domainMatch) {
    await docInitCommand(repoPath, {
      recommended: false,
      dryRun: false,
      force: false,
      timeout: options.timeout || 300,
      mode: 'chunked',
      strategy: 'improve',
      domains: domainMatch[1],
      model: options.model || null,
      hook: true,
      hooks: true,
      verbose: !!options.verbose,
      graph: options.graph !== false,
      target: target?.id || null,
      backend: options.backend || null,
      hooksOnly: false,
    });
    return;
  }

  p.log.warn(`Cannot apply automatically: ${action}`);
}
