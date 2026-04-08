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
    hooksInstalled: target.supportsHooks
      ? existsSync(join(repoPath, '.claude', 'hooks', 'skill-activation-prompt.sh'))
      : false,
    domainCoverage,
    drift,
  }, target);
  const health = computeHealthScore({
    instructionExists,
    skillCount: skillFiles.length,
    hooksInstalled: status.hooksInstalled,
    domainCoverage,
    hubCoverage,
    drift,
  }, target);
  const actions = recommendActions({ status, drift });

  return {
    id: target.id,
    label: target.label,
    instructionsFile: target.instructionsFile,
    instructionExists,
    skillCount: skillFiles.length,
    hooksInstalled: status.hooksInstalled,
    lastUpdated,
    drift,
    domainCoverage,
    hubCoverage,
    status,
    health,
    actions,
  };
}

export function computeDomainCoverage(domains, skills) {
  const details = (domains || [])
    .map(domain => domain?.name?.toLowerCase())
    .filter(Boolean)
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
  if (target.supportsHooks && !input.hooksInstalled) {
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
  const hooksInstalled = target.supportsHooks ? !!input.hooksInstalled : false;
  const hooks = target.supportsHooks ? (hooksInstalled ? 'healthy' : 'missing') : 'n/a';

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
  if (target.status.hooks === 'missing') {
    actions.push('aspens doc init --hooks-only');
  }
  if (target.status.domains === 'partial' && !actions.includes('aspens doc init --recommended')) {
    actions.push('aspens doc init --recommended');
  }
  return [...new Set(actions)];
}

export function summarizeReport(targets, sourceState) {
  const staleTargets = targets.filter(target => target.status.instructions === 'stale');
  const missingTargets = targets.filter(target =>
    target.status.instructions === 'missing' ||
    target.status.domains === 'missing' ||
    target.status.hooks === 'missing'
  );
  const partialTargets = targets.filter(target => target.status.domains === 'partial');
  const actions = [...new Set(targets.flatMap(target => target.actions))];

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
  };
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
