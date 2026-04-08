import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { scanRepo } from './scanner.js';
import { buildRepoGraph } from './graph-builder.js';
import { loadConfig, TARGETS } from './target.js';
import { findSkillFiles } from './skill-reader.js';

const SOURCE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.cs',
  '.php', '.swift', '.kt', '.kts', '.scala',
  '.clj', '.ex', '.exs', '.elm', '.vue', '.svelte',
]);

const LOW_SIGNAL_DOMAIN_NAMES = new Set([
  'config',
  'test',
  'tests',
  '__tests__',
  'spec',
  'e2e',
]);

export async function analyzeImpact(repoPath, options = {}) {
  const scan = scanRepo(repoPath);
  const { config } = loadConfig(repoPath, { persist: false });
  const targetIds = config?.targets?.length ? config.targets : inferTargetsFromScan(scan);
  const targets = targetIds.map(id => TARGETS[id]).filter(Boolean);
  const sourceState = collectSourceState(repoPath);

  let graph = null;
  if (options.graph !== false) {
    try {
      graph = await buildRepoGraph(repoPath, scan.languages);
    } catch {
      graph = null;
    }
  }

  const targetReports = targets.map(target => summarizeTarget(repoPath, target, scan, graph, sourceState));
  const summary = summarizeReport(targetReports, sourceState);

  return {
    scan,
    sourceState,
    targets: targetReports,
    summary,
    graph,
  };
}

export function summarizeTarget(repoPath, target, scan, graph, sourceState) {
  const skillFiles = findSkillFiles(join(repoPath, target.skillsDir), {
    skillFilename: target.skillFilename,
  });
  const hookHealth = target.supportsHooks ? evaluateHookHealth(repoPath) : null;
  const instructionPath = join(repoPath, target.instructionsFile);
  const instructionExists = existsSync(instructionPath);
  const contextText = buildContextText(repoPath, target, skillFiles);
  const topHubs = Array.isArray(graph?.hubs) ? graph.hubs.slice(0, 5).map(hub => hub.path) : [];
  const lastUpdated = latestMtime([
    ...(instructionExists ? [instructionPath] : []),
    ...skillFiles.map(skill => skill.path),
  ]);
  const domainCoverage = computeDomainCoverage(scan.domains, skillFiles);
  const hubCoverage = computeHubCoverage(topHubs, contextText);
  const drift = computeDrift(sourceState, lastUpdated, scan.domains);
  const status = computeTargetStatus({
    instructionExists,
    skillCount: skillFiles.length,
    hookHealth,
    domainCoverage,
    drift,
  }, target);
  const health = computeHealthScore({
    instructionExists,
    skillCount: skillFiles.length,
    hooksHealthy: status.hooks === 'healthy',
    domainCoverage,
    hubCoverage,
    drift,
  }, target);
  const usefulness = summarizeUsefulness({
    target,
    skillCount: skillFiles.length,
    domainCoverage,
    hubCoverage,
    status,
  });
  const actions = recommendActions({
    repoPath,
    target,
    status,
    drift,
    domainCoverage,
    hubCoverage,
    usefulness,
  });

  return {
    id: target.id,
    label: target.label,
    instructionsFile: target.instructionsFile,
    instructionExists,
    skillCount: skillFiles.length,
    hooksInstalled: status.hooksInstalled,
    hookHealth,
    lastUpdated,
    drift,
    domainCoverage,
    hubCoverage,
    status,
    health,
    usefulness,
    actions,
  };
}

export function computeDomainCoverage(domains, skills) {
  const domainList = (domains || [])
    .map(domain => domain?.name?.toLowerCase())
    .filter(Boolean);
  const relevantDomains = domainList.filter(name => !LOW_SIGNAL_DOMAIN_NAMES.has(name));
  const excludedDomains = domainList.filter(name => LOW_SIGNAL_DOMAIN_NAMES.has(name));

  const details = relevantDomains
    .map(name => {
      const match = findMatchingSkill(skills || [], name);
      return {
        domain: name,
        status: match ? 'covered' : 'missing',
        reason: match?.reason || 'no matching skill or activation rule',
        skill: match?.skillName || null,
      };
    });

  return {
    covered: details.filter(detail => detail.status === 'covered').length,
    total: details.length,
    missing: details.filter(detail => detail.status === 'missing').map(detail => detail.domain),
    excluded: excludedDomains,
    details,
  };
}

export function computeHubCoverage(hubPaths, contextText) {
  const haystack = (contextText || '').toLowerCase();
  const mentioned = (hubPaths || []).filter(path => haystack.includes(path.toLowerCase()));
  return {
    mentioned: mentioned.length,
    total: hubPaths?.length || 0,
    paths: mentioned,
  };
}

export function computeHealthScore(input, target) {
  let score = 100;

  if (!input.instructionExists) score -= 35;
  if (input.skillCount === 0) score -= 25;
  if (input.domainCoverage.total > 0) {
    const missingRatio = (input.domainCoverage.total - input.domainCoverage.covered) / input.domainCoverage.total;
    score -= Math.round(missingRatio * 25);
  }
  if (input.hubCoverage.total > 0) {
    const missedHubs = input.hubCoverage.total - input.hubCoverage.mentioned;
    score -= missedHubs * 4;
  }
  if (input.drift.changedFiles.length > 0) {
    score -= Math.min(20, input.drift.changedFiles.length * 3);
  }
  if (target.supportsHooks && !input.hooksHealthy) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function computeDrift(sourceState, lastUpdated, domains = []) {
  const changedFiles = (sourceState?.files || [])
    .filter(file => !lastUpdated || file.mtimeMs > lastUpdated)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const affectedDomains = new Set();
  for (const file of changedFiles) {
    const hit = (domains || []).find(domain =>
      (domain.directories || []).some(dir => file.path.startsWith(dir + '/') || file.path === dir)
    );
    if (hit?.name) affectedDomains.add(hit.name.toLowerCase());
  }

  const latestChange = changedFiles[0]?.mtimeMs || sourceState?.newestSourceMtime || 0;

  return {
    changedFiles,
    changedCount: changedFiles.length,
    affectedDomains: [...affectedDomains],
    latestChange,
    driftMs: lastUpdated && latestChange ? Math.max(0, latestChange - lastUpdated) : 0,
  };
}

export function computeTargetStatus(input, target) {
  const instructions = !input.instructionExists ? 'missing'
    : input.drift.changedCount > 0 ? 'stale'
    : 'healthy';
  const domains = input.domainCoverage.total === 0 ? 'n/a'
    : input.domainCoverage.covered === input.domainCoverage.total ? 'healthy'
    : input.domainCoverage.covered === 0 ? 'missing'
    : 'partial';
  const hooksInstalled = target.supportsHooks ? !!input.hookHealth?.installed : false;
  const hooks = !target.supportsHooks ? 'n/a'
    : !input.hookHealth?.installed ? 'missing'
    : input.hookHealth?.healthy ? 'healthy'
    : 'broken';

  return {
    instructions,
    domains,
    hooks,
    hooksInstalled,
  };
}

export function recommendActions(target) {
  const actions = [];
  if (target.status.instructions === 'missing' || target.status.domains === 'missing') {
    actions.push('aspens doc init --recommended');
  } else if (target.status.instructions === 'stale' || target.drift.changedCount > 0) {
    actions.push('aspens doc sync');
  }
  if (target.status.hooks === 'missing' || target.status.hooks === 'broken') {
    actions.push('aspens doc init --hooks-only');
  }
  if (target.status.domains === 'partial') {
    const missing = target.domainCoverage?.missing || [];
    if (missing.length > 0 && missing.length <= 3) {
      actions.push(`aspens doc init --mode chunked --domains ${missing.join(',')}`);
    } else if (!actions.includes('aspens doc init --recommended')) {
      actions.push('aspens doc init --recommended');
    }
  }
  if (
    target.status.instructions === 'healthy' &&
    target.status.domains === 'healthy' &&
    target.status.hooks !== 'missing' &&
    target.hubCoverage?.total > 0 &&
    target.hubCoverage.mentioned < target.hubCoverage.total
  ) {
    actions.push('aspens doc init --mode base-only --strategy rewrite');
  }
  return [...new Set(actions)];
}

export function summarizeReport(targets, sourceState) {
  const staleTargets = targets.filter(target => target.status.instructions === 'stale');
  const missingTargets = targets.filter(target =>
    target.status.instructions === 'missing' ||
    target.status.domains === 'missing' ||
    target.status.hooks === 'missing' ||
    target.status.hooks === 'broken'
  );
  const partialTargets = targets.filter(target => target.status.domains === 'partial');
  const actions = [...new Set(targets.flatMap(target => target.actions))];
  const missing = summarizeMissing(targets);

  return {
    repoStatus:
      missingTargets.length > 0 ? 'missing context'
      : staleTargets.length > 0 ? 'partially stale'
      : partialTargets.length > 0 ? 'partial coverage'
      : 'healthy',
    changedFiles: Math.max(...targets.map(target => target.drift.changedCount), 0),
    affectedTargets: targets.filter(target => target.drift.changedCount > 0 || target.status.domains !== 'healthy' || target.status.instructions !== 'healthy').length,
    actions,
    averageHealth: targets.length > 0
      ? Math.round(targets.reduce((sum, target) => sum + target.health, 0) / targets.length)
      : 0,
    latestSourceMtime: sourceState.newestSourceMtime,
    missing,
  };
}

export function summarizeValueComparison(targets) {
  const instructionFilesPresent = targets.filter(target => target.instructionExists).length;
  const totalSkills = targets.reduce((sum, target) => sum + (target.skillCount || 0), 0);
  const coveredDomains = Math.max(...targets.map(target => target.domainCoverage?.covered || 0), 0);
  const totalDomains = Math.max(...targets.map(target => target.domainCoverage?.total || 0), 0);
  const hookTargets = targets.filter(target => target.status?.hooks !== 'n/a').length;
  const healthyHooks = targets.filter(target => target.status?.hooks === 'healthy').length;
  const staleTargets = targets.filter(target => target.status?.instructions === 'stale');
  const driftCount = Math.max(...targets.map(target => target.drift?.changedCount || 0), 0);
  const surfacedHubs = Math.max(...targets.map(target => target.hubCoverage?.mentioned || 0), 0);
  const totalHubs = Math.max(...targets.map(target => target.hubCoverage?.total || 0), 0);

  return {
    withoutAspens: `Without aspens artifacts, these targets would have 0 generated instruction files, 0 generated skills, and 0 surfaced hub files.`,
    withAspens: `With aspens now: ${instructionFilesPresent}/${targets.length} instruction file${targets.length === 1 ? '' : 's'} present, ${totalSkills} generated skill${totalSkills === 1 ? '' : 's'}, ${coveredDomains}/${totalDomains || 0} meaningful source domain${totalDomains === 1 ? '' : 's'} mapped, ${totalHubs > 0 ? `${surfacedHubs}/${totalHubs} top hub files surfaced` : 'no hub data available'}.`,
    freshness: staleTargets.length > 0
      ? `${staleTargets.length} target(s) are stale with ${driftCount} changed source file(s) since the last generation.`
      : 'Generated docs are current against the source tree.',
    automation: hookTargets > 0
      ? `${healthyHooks}/${hookTargets} hook-capable target${hookTargets === 1 ? '' : 's'} ${hookTargets === 1 ? 'has' : 'have'} automatic context loading installed.`
      : 'No hook-capable targets detected.',
  };
}

export function summarizeMissing(targets) {
  const items = [];

  const missingInstructions = targets.filter(target => target.status.instructions === 'missing');
  if (missingInstructions.length > 0) {
    items.push({
      kind: 'instructions',
      severity: 'high',
      message: `${missingInstructions.length} target(s) are missing root instruction files`,
    });
  }

  const staleTargets = targets.filter(target => target.status.instructions === 'stale');
  if (staleTargets.length > 0) {
    const changedFiles = Math.max(...staleTargets.map(target => target.drift.changedCount), 0);
    items.push({
      kind: 'stale',
      severity: 'high',
      message: `${staleTargets.length} target(s) have stale docs with ${changedFiles} changed source file(s) since generation`,
    });
  }

  const missingHooks = targets.filter(target => target.status.hooks === 'missing');
  if (missingHooks.length > 0) {
    items.push({
      kind: 'hooks',
      severity: 'medium',
      message: `${missingHooks.length} hook-capable target(s) are missing automatic context loading`,
    });
  }

  const brokenHooks = targets.filter(target => target.status.hooks === 'broken');
  if (brokenHooks.length > 0) {
    items.push({
      kind: 'hook-errors',
      severity: 'high',
      message: brokenHooks
        .map(target => `${target.label} hooks are configured but broken`)
        .join(' | '),
    });
  }

  const uncoveredDomains = [...new Set(targets.flatMap(target => target.domainCoverage?.missing || []))];
  if (uncoveredDomains.length > 0) {
    items.push({
      kind: 'domains',
      severity: 'medium',
      message: `${uncoveredDomains.length} meaningful source domain(s) are not matched by dedicated skills or activation rules: ${uncoveredDomains.slice(0, 4).join(', ')}`,
    });
  }

  const weakRootContext = targets
    .filter(target => target.hubCoverage?.total > 0 && target.hubCoverage.mentioned < target.hubCoverage.total)
    .map(target => ({
      label: target.label,
      missing: target.hubCoverage.total - target.hubCoverage.mentioned,
    }));
  if (weakRootContext.length > 0) {
    items.push({
      kind: 'root-context',
      severity: 'low',
      message: weakRootContext
        .map(item => `${item.label} is missing ${item.missing} top hub file${item.missing === 1 ? '' : 's'} from root context`)
        .join(' | '),
    });
  }

  return items;
}

export function evaluateHookHealth(repoPath) {
  const settingsPath = join(repoPath, '.claude', 'settings.json');
  const rulesPath = join(repoPath, '.claude', 'skills', 'skill-rules.json');
  const hooksDir = join(repoPath, '.claude', 'hooks');
  const requiredScripts = [
    'skill-activation-prompt.sh',
    'graph-context-prompt.sh',
    'post-tool-use-tracker.sh',
  ];

  const installed = existsSync(join(hooksDir, 'skill-activation-prompt.sh'));
  const missingScripts = requiredScripts.filter(file => !existsSync(join(hooksDir, file)));
  const issues = [];

  if (!existsSync(settingsPath)) {
    issues.push('missing .claude/settings.json');
  }
  if (!existsSync(rulesPath)) {
    issues.push('missing .claude/skills/skill-rules.json');
  }
  if (missingScripts.length > 0) {
    issues.push(`missing hook scripts: ${missingScripts.join(', ')}`);
  }

  const invalidCommands = [];
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const commands = extractHookCommandsFromSettings(settings);
      for (const command of commands) {
        if (!command.includes('.claude/hooks/')) continue;
        const resolvedPath = commandToHookPath(command, repoPath);
        if (!resolvedPath || !existsSync(resolvedPath)) {
          invalidCommands.push(command);
        }
      }
    } catch {
      issues.push('invalid .claude/settings.json');
    }
  }

  if (invalidCommands.length > 0) {
    issues.push(`broken hook commands: ${invalidCommands.length}`);
  }

  return {
    installed,
    healthy: installed && issues.length === 0,
    issues,
    invalidCommands,
    missingScripts,
  };
}

function extractHookCommandsFromSettings(settings) {
  const commands = [];
  if (!settings?.hooks || typeof settings.hooks !== 'object') return commands;
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) continue;
      for (const hook of entry.hooks) {
        if (typeof hook?.command === 'string') commands.push(hook.command);
      }
    }
  }
  return commands;
}

function commandToHookPath(command, repoPath) {
  const match = command.match(/\$CLAUDE_PROJECT_DIR\/(.+?\.sh)\b/);
  if (!match) return null;
  return join(repoPath, ...match[1].split('/'));
}

function inferTargetsFromScan(scan) {
  const targets = [];
  if (scan.hasClaudeConfig || scan.hasClaudeMd) targets.push('claude');
  if (scan.hasCodexConfig || scan.hasAgentsMd) targets.push('codex');
  return targets.length > 0 ? targets : ['claude'];
}

function buildContextText(repoPath, target, skillFiles) {
  const parts = [];
  const instructionPath = join(repoPath, target.instructionsFile);
  if (existsSync(instructionPath)) {
    try {
      parts.push(readFileSync(instructionPath, 'utf8'));
    } catch { /* ignore unreadable artifact */ }
  }

  for (const skill of skillFiles) {
    const name = (skill.frontmatter?.name || skill.name || '').toLowerCase();
    if (name === 'base') {
      parts.push(skill.content);
    }
  }

  return parts.join('\n\n');
}

function findMatchingSkill(skills, domainName) {
  for (const skill of skills) {
    const skillName = (skill.frontmatter?.name || skill.name || '').toLowerCase();
    if (skillName === domainName || skillName.includes(domainName)) {
      return { skillName, reason: `skill "${skillName}"` };
    }

    const activationPatterns = Array.isArray(skill.activationPatterns) ? skill.activationPatterns : [];
    const matchingPattern = activationPatterns.find(pattern => {
      const lower = pattern.toLowerCase();
      return (
        lower.includes(`/${domainName}/`) ||
        lower.includes(`/${domainName}.`) ||
        lower.endsWith(`/${domainName}`) ||
        lower.includes(domainName)
      );
    });
    if (matchingPattern) {
      return { skillName, reason: `activation "${matchingPattern}"` };
    }
  }
  return null;
}

function summarizeUsefulness(input) {
  const strengths = [];
  const blindSpots = [];
  const activationExamples = [];

  strengths.push(`${input.skillCount} skill${input.skillCount === 1 ? '' : 's'} available to the agent`);

  if (input.domainCoverage.total > 0) {
    strengths.push(`${input.domainCoverage.covered}/${input.domainCoverage.total} source modules map to skills or activation rules`);
  }

  if (input.target.supportsHooks && input.status.hooks === 'healthy') {
    strengths.push('hooks can auto-load relevant Claude context while you work');
  }

  if (input.hubCoverage.total > 0 && input.hubCoverage.mentioned > 0) {
    strengths.push(`${input.hubCoverage.mentioned}/${input.hubCoverage.total} top hub files are surfaced in root context`);
  }

  for (const detail of input.domainCoverage.details.filter(d => d.status === 'covered').slice(0, 3)) {
    activationExamples.push(`${detail.domain} -> ${detail.reason}`);
  }

  const missing = input.domainCoverage.details.filter(d => d.status === 'missing');
  if (missing.length > 0) {
    blindSpots.push(`${missing.length} uncovered module${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 3).map(d => d.domain).join(', ')}`);
  }

  if ((input.domainCoverage.excluded || []).length > 0) {
    strengths.push(`support buckets excluded from scoring: ${(input.domainCoverage.excluded || []).slice(0, 3).join(', ')}`);
  }

  if (input.hubCoverage.total > 0 && input.hubCoverage.mentioned < input.hubCoverage.total) {
    blindSpots.push(`${input.hubCoverage.total - input.hubCoverage.mentioned} top hub file${input.hubCoverage.total - input.hubCoverage.mentioned === 1 ? '' : 's'} still missing from root context`);
  }

  return {
    strengths,
    blindSpots,
    activationExamples,
  };
}

function collectSourceState(repoPath) {
  const files = [];
  let newestSourceMtime = 0;

  function walk(dir, depth) {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === 'build' ||
        entry === 'coverage' ||
        entry === '.git'
      ) {
        continue;
      }

      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }

      if (!SOURCE_EXTS.has(extname(entry))) continue;

      const relPath = relative(repoPath, full);
      files.push({ path: relPath, mtimeMs: stat.mtimeMs });
      if (stat.mtimeMs > newestSourceMtime) {
        newestSourceMtime = stat.mtimeMs;
      }
    }
  }

  walk(repoPath, 0);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    newestSourceMtime,
    sourceFiles: files.length,
    files,
  };
}

function latestMtime(paths) {
  let newest = 0;
  for (const filePath of paths) {
    try {
      const mtime = statSync(filePath).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch {
      // Ignore unreadable files.
    }
  }
  return newest;
}
