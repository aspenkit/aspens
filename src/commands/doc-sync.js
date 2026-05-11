import { resolve, join, relative, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runLLM, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles, writeTransformedFiles, extractRulesFromSkills } from '../lib/skill-writer.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { persistGraphArtifacts, loadGraph, extractSubgraph, formatNavigationContext } from '../lib/graph-persistence.js';
import { findSkillFiles, parseActivationPatterns, getActivationBlock, fileMatchesActivation } from '../lib/skill-reader.js';
import { buildDomainContext, buildBaseContext } from '../lib/context-builder.js';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';
import { installGitHook, removeGitHook } from '../lib/git-hook.js';
import { isGitRepo, getGitRoot, getGitDiff, getGitLog, getChangedFiles } from '../lib/git-helpers.js';
import { TARGETS, getAllowedPaths, loadConfig } from '../lib/target.js';
import { getSelectedFilesDiff, buildPrioritizedDiff, truncate } from '../lib/diff-helpers.js';
import { projectCodexDomainDocs, transformForTarget, assertTargetParity, syncSkillsSection, syncBehaviorSection, ensureRootKeyFilesSection } from '../lib/target-transform.js';
import { isNoOpDiff } from '../lib/diff-classifier.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const PARALLEL_LIMIT = 3;

function parseOutput(text, allowedPaths) {
  return parseFileOutput(text, allowedPaths);
}

function buildDerivedCodexFiles(files, target, scan) {
  if (target.id !== 'codex') return [];
  return projectCodexDomainDocs(files, target, scan);
}

function dedupeFiles(files) {
  const byPath = new Map();
  for (const file of files) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

function configuredTargets(repoPath) {
  const { config } = loadConfig(repoPath);
  const targetIds = Array.isArray(config?.targets) && config.targets.length > 0
    ? config.targets
    : ['claude'];
  return targetIds
    .map(id => TARGETS[id])
    .filter(Boolean);
}

function chooseSyncSourceTarget(repoPath, targets) {
  const claudeTarget = targets.find(t => t.id === 'claude');
  if (claudeTarget && existsSync(join(repoPath, claudeTarget.skillsDir))) {
    return claudeTarget;
  }

  for (const target of targets) {
    if (target.skillsDir && existsSync(join(repoPath, target.skillsDir))) {
      return target;
    }
  }

  return targets[0] || TARGETS.claude;
}

/**
 * Backwards-compat helper (Phase 1: stability). v0.7 emitted a `## Key Files`
 * block with hub counts in CLAUDE.md/AGENTS.md. Phase 1 removes that block.
 * On the first sync after upgrade we surface a one-line notice so the resulting
 * diff isn't alarming.
 */
const LEGACY_HUB_BLOCK_RE = /^## Key Files\b[\s\S]*?(?:Hub files|most depended-on|N dependents|\d+ dependents)/m;
const LEGACY_CODE_MAP_HUB_RE = /^\*\*Hub files\b/m;

/**
 * Force-regenerate `.claude/code-map.md` when it carries the v0.7 hub-files
 * block. Phase 6 agents read code-map; we don't want them seeing stale format
 * even on a no-op sync.
 */
async function regenerateStaleCodeMap(repoPath, sourceTarget, scan) {
  const codeMapPath = join(repoPath, '.claude', 'code-map.md');
  let needsRegen = false;
  try {
    const content = readFileSync(codeMapPath, 'utf8');
    if (LEGACY_CODE_MAP_HUB_RE.test(content)) needsRegen = true;
  } catch {
    return; // no code-map present — nothing to do
  }
  if (!needsRegen) return;

  try {
    const rawGraph = await buildRepoGraph(repoPath, scan.languages);
    persistGraphArtifacts(repoPath, rawGraph, { target: sourceTarget });
    p.log.info('Regenerated .claude/code-map.md (legacy hub-files block detected)');
  } catch {
    // best-effort — surface nothing on failure
  }
}

function notifyLegacyHubBlockIfPresent(repoPath) {
  const candidates = ['CLAUDE.md', 'AGENTS.md'];
  for (const file of candidates) {
    try {
      const content = readFileSync(join(repoPath, file), 'utf8');
      if (LEGACY_HUB_BLOCK_RE.test(content)) {
        p.log.info(`First sync after upgrade: removing legacy hub-counts block from ${file} (no longer needed)`);
        return;
      }
    } catch {}
  }
}

/**
 * Build the per-target file map. Returns Map<targetId, files[]> so callers
 * can route writes per target and so the parity validator can compare slots
 * across targets. Use `flattenPublishedMap` when a flat list is needed.
 */
/**
 * No-LLM repair pass: re-injects the deterministic `## Skills` + `## Behavior`
 * sections into the root instructions file from on-disk state. Runs from the
 * no-op / "up to date" sync paths so missing-section drift is fixed every time
 * the user invokes sync, even when no diff or LLM update happens.
 *
 * Returns the list of written file results (empty when nothing needed updating).
 */
export function repairDeterministicSections(repoPath, sourceTarget, publishTargets, scan, graphSerialized = null) {
  const instructionsFile = sourceTarget?.instructionsFile || 'CLAUDE.md';
  const instrPath = join(repoPath, instructionsFile);
  if (!existsSync(instrPath)) return [];

  const existingSkills = findExistingSkills(repoPath, sourceTarget);
  const baseSkillForList = existingSkills.find(s => s.name === 'base') || null;
  const domainSkillsForList = existingSkills.filter(s => s.name !== 'base');
  const startContent = readFileSync(instrPath, 'utf8');

  let updated = ensureRootKeyFilesSection(startContent);
  updated = syncSkillsSection(updated, baseSkillForList, domainSkillsForList, sourceTarget, false);
  updated = syncBehaviorSection(updated);
  if (updated === startContent) return [];

  const baseFiles = [{ path: instructionsFile, content: updated }];
  const perTarget = publishFilesForTargets(baseFiles, sourceTarget, publishTargets, scan, graphSerialized, repoPath);
  const files = flattenPublishedMap(perTarget);
  const directWriteFiles = files.filter(f => !(f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md'));
  const dirScopedFiles = files.filter(f => f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md');
  return [
    ...writeSkillFiles(repoPath, directWriteFiles, { force: true }),
    ...writeTransformedFiles(repoPath, dirScopedFiles, { force: true }),
  ];
}

function publishFilesForTargets(baseFiles, sourceTarget, publishTargets, scan, graphSerialized = null, repoPath = null) {
  const perTarget = new Map();

  for (const target of publishTargets) {
    let files;
    if (target.id === sourceTarget.id) {
      files = [...baseFiles, ...buildDerivedCodexFiles(baseFiles, target, scan)];
    } else {
      files = transformForTarget(baseFiles, sourceTarget, target, {
        scanResult: scan,
        graphSerialized,
        repoPath,
      });
    }
    perTarget.set(target.id, dedupeFiles(files));
  }

  assertTargetParity(perTarget);
  return perTarget;
}

function flattenPublishedMap(perTarget) {
  const all = [];
  for (const files of perTarget.values()) {
    all.push(...files);
  }
  return dedupeFiles(all);
}

export async function docSyncCommand(path, options) {
  const repoPath = resolve(path);
  const gitRoot = getGitRoot(repoPath);
  const projectPrefix = toGitRelative(gitRoot, repoPath);
  const verbose = !!options.verbose;
  const commits = typeof options.commits === 'number' ? options.commits : 1;

  // Install/remove hook mode
  if (options.installHook) {
    return installGitHook(repoPath);
  }
  if (options.removeHook) {
    return removeGitHook(repoPath);
  }

  // Determine configured publish targets and the best source target for sync.
  const { config, recovered } = loadConfig(repoPath);
  const publishTargets = configuredTargets(repoPath);
  const sourceTarget = chooseSyncSourceTarget(repoPath, publishTargets);
  const backendId = config?.backend || sourceTarget.id;
  const allowedPaths = getAllowedPaths([sourceTarget]);
  const skillsDir = sourceTarget.skillsDir ? join(repoPath, sourceTarget.skillsDir) : join(repoPath, TARGETS.claude.skillsDir);

  if (recovered && config?.targets?.length) {
    p.log.warn(`Recovered missing .aspens.json from existing repo docs (${config.targets.join(', ')}).`);
  }

  // Refresh mode — skip diff, review all skills against current codebase
  if (options.refresh) {
    return refreshAllSkills(repoPath, options, sourceTarget, publishTargets);
  }

  p.intro(pc.cyan('aspens doc sync'));

  // Step 1: Check prerequisites
  if (!gitRoot || !isGitRepo(repoPath)) {
    throw new CliError('Not a git repository. doc sync requires git history.');
  }

  if (!existsSync(skillsDir)) {
    throw new CliError(`No ${sourceTarget.skillsDir || '.claude/skills'}/ found. Run aspens doc init first.`);
  }

  // Step 2: Get git diff
  const diffSpinner = p.spinner();
  diffSpinner.start(`Reading last ${commits} commit(s)...`);

  const { actualCommits } = getGitDiff(gitRoot, commits);
  if (actualCommits < commits) {
    diffSpinner.message(`Only ${actualCommits} commit(s) available (requested ${commits})`);
  }
  const commitLog = getGitLog(gitRoot, actualCommits);
  const changedFiles = scopeProjectFiles(getChangedFiles(gitRoot, actualCommits), projectPrefix);
  diffSpinner.stop(`${changedFiles.length} files changed`);

  if (changedFiles.length === 0) {
    const repairs = repairDeterministicSections(repoPath, sourceTarget, publishTargets, scanRepo(repoPath));
    if (repairs.length > 0) {
      console.log();
      for (const wr of repairs) console.log(`  ${pc.yellow('~')} ${wr.path} ${pc.dim('(deterministic section repair)')}`);
    }
    p.outro(repairs.length > 0 ? 'No diffs — repaired deterministic sections' : 'Nothing to sync');
    return;
  }

  // Phase 1: changetype filter — skip the LLM call entirely on lockfile-only
  // diffs and diffs that touch zero code-bearing files.
  if (isNoOpDiff(changedFiles)) {
    if (verbose) {
      p.log.info('Skipped: no code-bearing changes (lockfile bumps / non-code files only)');
    } else {
      p.log.info('Skipped: no code-bearing changes');
    }
    // If a stale-format code-map is on disk (legacy `## Hub files` block),
    // force a graph rebuild so subsequent reads see the modern format.
    const noOpScan = scanRepo(repoPath);
    await regenerateStaleCodeMap(repoPath, sourceTarget, noOpScan);
    const repairs = repairDeterministicSections(repoPath, sourceTarget, publishTargets, noOpScan);
    if (repairs.length > 0) {
      console.log();
      for (const wr of repairs) console.log(`  ${pc.yellow('~')} ${wr.path} ${pc.dim('(deterministic section repair)')}`);
    }
    p.outro(repairs.length > 0 ? 'No code changes — repaired deterministic sections' : 'No sync needed');
    return;
  }

  // Backwards-compat notice (Phase 1): if the user has a v0.7-era hub block
  // in CLAUDE.md/AGENTS.md, the upcoming sync will remove it. Surface this
  // once so the diff isn't surprising.
  notifyLegacyHubBlockIfPresent(repoPath);

  const diff = getSelectedFilesDiff(gitRoot, changedFiles.map(file => withProjectPrefix(file, projectPrefix)), actualCommits);

  // Show what changed
  console.log();
  for (const file of changedFiles.slice(0, 15)) {
    console.log(pc.dim('  ') + file);
  }
  if (changedFiles.length > 15) {
    console.log(pc.dim(`  ... and ${changedFiles.length - 15} more`));
  }
  console.log();

  // Step 3: Find affected skills
  const scan = scanRepo(repoPath);
  const existingSkills = findExistingSkills(repoPath, sourceTarget);

  // Rebuild graph from current state (keeps graph fresh on every sync)
  let repoGraph = null;
  let graphSerialized = null;
  let graphContext = '';
  if (options.graph !== false) {
    try {
      const rawGraph = await buildRepoGraph(repoPath, scan.languages);
      graphSerialized = persistGraphArtifacts(repoPath, rawGraph, { target: sourceTarget });
      repoGraph = loadGraph(repoPath);
      if (repoGraph) {
        const subgraph = extractSubgraph(repoGraph, changedFiles);
        graphContext = formatNavigationContext(subgraph);
      }
    } catch (err) {
      p.log.warn(`Graph context unavailable — proceeding without it. (${err.message})`);
    }
  }

  const affectedSkills = mapChangesToSkills(changedFiles, existingSkills, scan, repoGraph);

  if (affectedSkills.length > 0) {
    p.log.info(`Skills that may need updates: ${affectedSkills.map(s => pc.yellow(s.name)).join(', ')}`);
  } else {
    p.log.info('No skills directly affected, but the selected backend will check for structural changes.');
  }

  // Timeout priority: --timeout flag > ASPENS_TIMEOUT env var > auto-scaled default
  const autoTimeout = Math.min(300 + affectedSkills.length * 60, 900);
  const { timeoutMs, envWarning } = resolveTimeout(options.timeout, autoTimeout);
  if (envWarning) p.log.warn('ASPENS_TIMEOUT is not a valid number — using auto-scaled timeout.');

  // Step 4: Build prompt
  const today = new Date().toISOString().split('T')[0];
  const targetVars = {
    skillsDir: sourceTarget.skillsDir || '.claude/skills',
    skillFilename: sourceTarget.skillFilename || 'skill.md',
    instructionsFile: sourceTarget.instructionsFile || 'CLAUDE.md',
    configDir: sourceTarget.configDir || '.claude',
  };
  const systemPrompt = loadPrompt('doc-sync', targetVars);

  // Skill-relevant files (for diff prioritization and interactive picker pre-selection)
  const relevantFiles = changedFiles.filter(f =>
    affectedSkills.some(skill => fileMatchesActivation(f, getActivationBlock(skill.content)))
  );

  // Interactive file picker: offer when diff is large and a TTY is available
  let selectedFiles = changedFiles;
  if (diff.length > 80000 && process.stdout.isTTY) {
    const fullKb = Math.round(diff.length / 1024);
    console.log();
    p.log.warn(`Large diff (${fullKb}k chars) — select which files Claude should analyze:`);
    console.log(pc.dim('  Skill-relevant files are pre-selected. Deselect large docs/data files to save time.\n'));
    const picked = await p.multiselect({
      message: 'Files to include in analysis',
      options: changedFiles.map(f => ({
        value: f,
        label: f,
        hint: relevantFiles.includes(f) ? pc.cyan('skill-relevant') : '',
      })),
      initialValues: relevantFiles.length > 0 ? relevantFiles : changedFiles,
    });
    if (p.isCancel(picked)) {
      p.cancel('Sync cancelled');
      return;
    }
    if (picked.length === 0) {
      p.cancel('No files selected');
      return;
    }
    selectedFiles = picked;
  }

  // Build diff from selected files only, or use full prioritized diff
  let activeDiff;
  if (selectedFiles.length < changedFiles.length) {
    activeDiff = getSelectedFilesDiff(gitRoot, selectedFiles.map(file => withProjectPrefix(file, projectPrefix)), actualCommits);
    if (activeDiff.includes('(diff truncated')) {
      p.log.warn('Selected files still exceed 80k — diff truncated. Claude will use Read tool for the rest.');
    }
  } else {
    activeDiff = buildPrioritizedDiff(diff, relevantFiles);
    if (activeDiff.includes('(diff truncated')) {
      const fullKb = Math.round(diff.length / 1024);
      p.log.warn(`Large commit (${fullKb}k chars) — diff truncated. Claude will use Read tool for full file contents.`);
    }
  }

  // Send affected skills in full, others as just path + description (save tokens)
  const affectedPaths = new Set(affectedSkills.map(s => s.path));
  const skillContents = existingSkills.map(s => {
    if (affectedPaths.has(s.path)) {
      return `### ${s.path} (AFFECTED — may need updates)\n\`\`\`\n${s.content}\n\`\`\``;
    }
    const descMatch = s.content.match(/description:\s*(.+)/);
    const desc = descMatch ? descMatch[1].trim() : '';
    return `### ${s.path}\n${desc}`;
  }).join('\n\n');

  const instructionsFile = sourceTarget.instructionsFile || 'CLAUDE.md';
  const instructionsContent = existsSync(join(repoPath, instructionsFile))
    ? readFileSync(join(repoPath, instructionsFile), 'utf8')
    : '';

  const userPrompt = `Repository path: ${repoPath}
Today's date: ${today}

## Recent Commits
\`\`\`
${commitLog}
\`\`\`

## Git Diff
\`\`\`diff
${activeDiff}
\`\`\`

## Changed Files
${selectedFiles.join('\n')}
${graphContext ? `\n## Import Graph Context\n${graphContext}\n` : ''}
## Existing Skills
${skillContents}

## Existing ${instructionsFile}
\`\`\`
${truncate(instructionsContent, 5000)}
\`\`\``;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  // Step 5: Run backend
  const syncSpinner = p.spinner();
  syncSpinner.start('Analyzing changes and updating skills...');

  let result;
  try {
    result = await runLLM(fullPrompt, {
      timeout: timeoutMs,
      allowedTools: READ_ONLY_TOOLS,
      verbose,
      model: options.model || null,
      onActivity: verbose ? (msg) => syncSpinner.message(pc.dim(msg)) : null,
      cwd: repoPath,
    }, backendId);
  } catch (err) {
    syncSpinner.stop(pc.red('Failed'));
    throw new CliError(err.message, { cause: err });
  }

  // Step 6: Parse output
  const baseFiles = parseOutput(result.text, allowedPaths);
  if (baseFiles.length === 0 && result.text.trim().length > 0 && !/<file\s+path=/i.test(result.text)) {
    if (verbose) {
      p.log.warn('LLM responded without <file> tags — treating as no updates needed.');
    }
  }

  // Deterministic `## Skills` + `## Behavior` injection on the canonical
  // instructions file. Runs whether or not the LLM updated it, so drift
  // gets repaired every sync. Source target paths flow through unchanged;
  // transformForTarget handles the codex/claude projection downstream.
  {
    const instrPath = join(repoPath, instructionsFile);
    const pending = baseFiles.find(f => f.path === instructionsFile);
    const startContent = pending
      ? pending.content
      : (existsSync(instrPath) ? readFileSync(instrPath, 'utf8') : null);

    if (startContent != null) {
      const baseSkillForList = existingSkills.find(s => s.name === 'base') || null;
      const domainSkillsForList = existingSkills.filter(s => s.name !== 'base');

      let updated = ensureRootKeyFilesSection(startContent);
      updated = syncSkillsSection(
        updated,
        baseSkillForList,
        domainSkillsForList,
        sourceTarget,
        false
      );
      updated = syncBehaviorSection(updated);

      if (updated !== startContent) {
        if (pending) pending.content = updated;
        else baseFiles.push({ path: instructionsFile, content: updated });
      }
    }
  }

  const perTarget = publishFilesForTargets(baseFiles, sourceTarget, publishTargets, scan, graphSerialized, repoPath);
  const files = flattenPublishedMap(perTarget);

  if (files.length === 0) {
    syncSpinner.stop('No updates needed');
    p.outro('Docs are up to date');
    return;
  }

  syncSpinner.stop(`${pc.bold(files.length)} file(s) to update`);

  // Show what will be updated
  console.log();
  for (const file of files) {
    console.log(pc.dim('  ') + pc.yellow('~') + ' ' + file.path);
  }
  console.log();

  // Dry run
  if (options.dryRun) {
    p.log.info('Dry run — no files written. Preview:');
    for (const file of files) {
      console.log(pc.bold(`\n--- ${file.path} ---`));
      console.log(pc.dim(file.content));
    }
    p.outro('Dry run complete');
    return;
  }

  // Write
  const directWriteFiles = files.filter(f => !(f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md'));
  const dirScopedFiles = files.filter(f => f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md');
  const results = [
    ...writeSkillFiles(repoPath, directWriteFiles, { force: true }),
    ...writeTransformedFiles(repoPath, dirScopedFiles, { force: true }),
  ];

  console.log();
  for (const wr of results) {
    const icon = wr.status === 'overwritten' ? pc.yellow('~') : pc.green('+');
    console.log(`  ${icon} ${wr.path}`);
  }

  // Regenerate skill-rules.json so hooks see updated activation patterns (Claude-only)
  const hookTarget = publishTargets.find(t => t.supportsHooks);
  if (hookTarget) {
    try {
      const hookSkillsDir = join(repoPath, hookTarget.skillsDir);
      const rules = extractRulesFromSkills(hookSkillsDir);
      writeFileSync(join(hookSkillsDir, 'skill-rules.json'), JSON.stringify(rules, null, 2) + '\n');
    } catch { /* non-fatal */ }
  }

  console.log();
  p.outro(`${results.length} file(s) updated`);
}

function toGitRelative(gitRoot, repoPath) {
  if (!gitRoot) return '';
  const rel = relative(gitRoot, repoPath);
  if (!rel || rel === '.') return '';
  return rel.split('\\').join('/');
}

function withProjectPrefix(file, projectPrefix) {
  return projectPrefix ? `${projectPrefix}/${file}` : file;
}

function scopeProjectFiles(files, projectPrefix) {
  if (!projectPrefix) return files;
  const prefix = `${projectPrefix}/`;
  return files
    .filter(file => file.startsWith(prefix))
    .map(file => file.slice(prefix.length));
}

// --- Skill mapping ---

function findExistingSkills(repoPath, target) {
  const sd = target?.skillsDir || '.claude/skills';
  const sf = target?.skillFilename || 'skill.md';
  const fullDir = join(repoPath, sd);
  return findSkillFiles(fullDir, { skillFilename: sf }).map(s => ({
    name: s.name,
    path: relative(repoPath, s.path),
    content: s.content,
  }));
}

function mapChangesToSkills(changedFiles, existingSkills, scan, repoGraph = null) {
  const affected = [];

  for (const skill of existingSkills) {
    if (skill.name === 'base') continue; // base handled separately below

    const activationBlock = getActivationBlock(skill.content);
    if (!activationBlock) continue;

    let isAffected = changedFiles.some(file => fileMatchesActivation(file, activationBlock));

    // Graph-aware: check if changed files are imported by files in this skill's domain
    if (!isAffected && repoGraph) {
      isAffected = changedFiles.some(file => {
        const info = repoGraph.files[file];
        if (!info) return false;
        return (info.importedBy || []).some(dep => fileMatchesActivation(dep, activationBlock));
      });
    }

    if (isAffected) {
      affected.push(skill);
    }
  }

  // Flag base skill if structural files changed
  const structuralFiles = ['package.json', 'requirements.txt', 'pyproject.toml', 'Makefile', 'Dockerfile', 'tsconfig.json'];
  if (changedFiles.some(f => structuralFiles.includes(f))) {
    const baseSkill = existingSkills.find(s => s.name === 'base');
    if (baseSkill && !affected.includes(baseSkill)) {
      affected.push(baseSkill);
    }
  }

  return affected;
}

// --- Refresh mode ---

async function refreshAllSkills(repoPath, options, sourceTarget, publishTargets = [sourceTarget]) {
  const verbose = !!options.verbose;
  const { config, recovered } = loadConfig(repoPath);
  const backendId = config?.backend || sourceTarget?.id || 'claude';
  const allowedPaths = getAllowedPaths([sourceTarget || TARGETS.claude]);
  let graphSerialized = null;

  p.intro(pc.cyan('aspens doc sync --refresh'));

  if (recovered && config?.targets?.length) {
    p.log.warn(`Recovered missing .aspens.json from existing repo docs (${config.targets.join(', ')}).`);
  }

  // Prerequisites
  if (!isGitRepo(repoPath)) {
    throw new CliError('Not a git repository.');
  }
  const sd = sourceTarget?.skillsDir || '.claude/skills';
  const refreshSkillsDir = join(repoPath, sd);
  if (!existsSync(refreshSkillsDir)) {
    throw new CliError(`No ${sd}/ found. Run aspens doc init first.`);
  }

  // Step 1: Scan + graph
  const scanSpinner = p.spinner();
  scanSpinner.start(options.graph !== false ? 'Scanning repo and building import graph...' : 'Scanning repo...');

  const scan = scanRepo(repoPath);
  if (options.graph !== false) {
    try {
      const rawGraph = await buildRepoGraph(repoPath, scan.languages);
      graphSerialized = persistGraphArtifacts(repoPath, rawGraph, { target: sourceTarget });
    } catch (err) {
      p.log.warn(`Graph build failed — continuing without it. (${err.message})`);
    }
  }

  scanSpinner.stop('Scan complete');

  // Step 2: Load existing skills
  const existingSkills = findExistingSkills(repoPath, sourceTarget);
  if (existingSkills.length === 0) {
    const sd = sourceTarget?.skillsDir || '.claude/skills';
    throw new CliError(`No skills found in ${sd}/. Run aspens doc init first.`);
  }

  const baseSkill = existingSkills.find(s => s.name === 'base');
  const domainSkills = existingSkills.filter(s => s.name !== 'base');

  p.log.info(`Found ${existingSkills.length} skill(s): ${existingSkills.map(s => pc.cyan(s.name)).join(', ')}`);

  // Timeout: --timeout flag > ASPENS_TIMEOUT env > auto-scaled
  const autoTimeout = Math.min(120 + existingSkills.length * 60, 900);
  const { timeoutMs: perSkillTimeout } = resolveTimeout(options.timeout, autoTimeout);

  const today = new Date().toISOString().split('T')[0];
  const refreshVars = {
    skillsDir: sourceTarget?.skillsDir || '.claude/skills',
    skillFilename: sourceTarget?.skillFilename || 'skill.md',
    instructionsFile: sourceTarget?.instructionsFile || 'CLAUDE.md',
    configDir: sourceTarget?.configDir || '.claude',
  };
  const systemPrompt = loadPrompt('doc-sync-refresh', refreshVars);
  const allUpdatedFiles = [];

  // Step 3: Refresh base skill first
  if (baseSkill) {
    const baseSpinner = p.spinner();
    baseSpinner.start('Refreshing base skill...');

    try {
      const baseContext = buildBaseContext(repoPath, scan);
      const prompt = `${systemPrompt}\n\n---\n\nRepository path: ${repoPath}\nToday's date: ${today}\n\n## Existing Skill\n\`\`\`\n${baseSkill.content}\n\`\`\`\n\n## Current Codebase\n${baseContext}`;

      const result = await runLLM(prompt, {
        timeout: perSkillTimeout,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        model: options.model || null,
        onActivity: verbose ? (msg) => baseSpinner.message(pc.dim(msg)) : null,
        cwd: repoPath,
      }, backendId);

      const files = parseOutput(result.text, allowedPaths);
      if (files.length > 0) {
        allUpdatedFiles.push(...files);
        baseSpinner.stop(pc.yellow('base') + ' — updated');
      } else {
        baseSpinner.stop(pc.dim('base') + ' — up to date');
      }
    } catch (err) {
      baseSpinner.stop(pc.red('base — failed: ') + err.message);
    }
  }

  // Step 4: Refresh domain skills in parallel batches
  if (domainSkills.length > 0) {
    for (let i = 0; i < domainSkills.length; i += PARALLEL_LIMIT) {
      const batch = domainSkills.slice(i, i + PARALLEL_LIMIT);

      const batchResults = await Promise.all(batch.map(async (skill) => {
        const skillSpinner = p.spinner();
        skillSpinner.start(`Refreshing ${pc.cyan(skill.name)}...`);

        try {
          const domain = skillToDomain(skill);
          const domainContext = buildDomainContext(repoPath, scan, domain);

          const prompt = `${systemPrompt}\n\n---\n\nRepository path: ${repoPath}\nToday's date: ${today}\n\n## Existing Skill\n\`\`\`\n${skill.content}\n\`\`\`\n\n## Current Codebase (${skill.name} domain)\n${domainContext}`;

          const result = await runLLM(prompt, {
            timeout: perSkillTimeout,
            allowedTools: READ_ONLY_TOOLS,
            verbose,
            model: options.model || null,
            onActivity: verbose ? (msg) => skillSpinner.message(pc.dim(msg)) : null,
            cwd: repoPath,
          }, backendId);

          const files = parseOutput(result.text, allowedPaths);
          if (files.length > 0) {
            skillSpinner.stop(pc.yellow(skill.name) + ' — updated');
            return files;
          } else {
            skillSpinner.stop(pc.dim(skill.name) + ' — up to date');
            return [];
          }
        } catch (err) {
          skillSpinner.stop(pc.red(`${skill.name} — failed: `) + err.message);
          return [];
        }
      }));

      for (const files of batchResults) {
        allUpdatedFiles.push(...files);
      }
    }
  }

  // Step 5: Refresh instructions file (CLAUDE.md or AGENTS.md) if it exists
  const instrFile = sourceTarget?.instructionsFile || 'CLAUDE.md';
  const instrPath = join(repoPath, instrFile);
  if (existsSync(instrPath)) {
    const claudeSpinner = p.spinner();
    claudeSpinner.start(`Checking ${instrFile}...`);

    try {
      const claudeMd = readFileSync(instrPath, 'utf8');
      const skillSummaries = existingSkills.map(s => {
        const descMatch = s.content.match(/description:\s*(.+)/);
        return `- **${s.name}**: ${descMatch ? descMatch[1].trim() : ''}`;
      }).join('\n');

      const claudePrompt = `${systemPrompt}\n\n---\n\nRepository path: ${repoPath}\nToday's date: ${today}\n\n## Existing Skill\n\`\`\`\n${claudeMd}\n\`\`\`\n\n## Installed Skills\n${skillSummaries}\n\n## Current Codebase\n${buildBaseContext(repoPath, scan)}`;

      const claudeResult = await runLLM(claudePrompt, {
        timeout: perSkillTimeout,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        model: options.model || null,
        onActivity: verbose ? (msg) => claudeSpinner.message(pc.dim(msg)) : null,
        cwd: repoPath,
      }, backendId);

      const claudeFiles = parseOutput(claudeResult.text, allowedPaths);
      if (claudeFiles.length > 0) {
        allUpdatedFiles.push(...claudeFiles);
        claudeSpinner.stop(pc.yellow(instrFile) + ' — updated');
      } else {
        claudeSpinner.stop(pc.dim(instrFile) + ' — up to date');
      }
    } catch (err) {
      claudeSpinner.stop(pc.red(`${instrFile} — failed: `) + err.message);
    }
  }

  // Step 5b: Deterministically (re)inject `## Skills` and `## Behavior`, even
  // when the LLM didn't propose an update — guarantees drift repair every sync.
  if (existsSync(instrPath)) {
    const pending = allUpdatedFiles.find(f => f.path === instrFile);
    const startContent = pending ? pending.content : readFileSync(instrPath, 'utf8');
    const baseSkillForList = existingSkills.find(s => s.name === 'base') || null;
    const domainSkillsForList = existingSkills.filter(s => s.name !== 'base');

    let updated = ensureRootKeyFilesSection(startContent);
    updated = syncSkillsSection(
      updated,
      baseSkillForList,
      domainSkillsForList,
      sourceTarget,
      false
    );
    updated = syncBehaviorSection(updated);

    if (updated !== startContent) {
      if (pending) pending.content = updated;
      else allUpdatedFiles.push({ path: instrFile, content: updated });
    }
  }

  // Step 6: Check for uncovered domains
  const coveredNames = new Set(existingSkills.map(s => s.name.toLowerCase()));
  const uncoveredDomains = (scan.domains || []).filter(d =>
    !coveredNames.has(d.name.toLowerCase())
  );

  if (uncoveredDomains.length > 0) {
    console.log();
    p.log.info(`Potential uncovered domains: ${uncoveredDomains.map(d => pc.yellow(d.name)).join(', ')}`);
    p.log.info(pc.dim('Run aspens doc init --mode chunked --domains "' + uncoveredDomains.map(d => d.name).join(',') + '" to generate skills for these.'));
  }

  // Step 7: Write results
  if (allUpdatedFiles.length === 0) {
    console.log();
    p.outro('All skills are up to date');
    return;
  }

  // Dry run
  if (options.dryRun) {
    console.log();
    p.log.info(`Dry run — ${allUpdatedFiles.length} file(s) would be updated:`);
    for (const file of allUpdatedFiles) {
      console.log(pc.dim('  ') + pc.yellow('~') + ' ' + file.path);
    }
    p.outro('Dry run complete');
    return;
  }

  const refreshPerTarget = publishFilesForTargets(allUpdatedFiles, sourceTarget, publishTargets, scan, graphSerialized, repoPath);
  const filesToWrite = flattenPublishedMap(refreshPerTarget);
  const directWriteFiles = filesToWrite.filter(f => !(f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md'));
  const dirScopedFiles = filesToWrite.filter(f => f.path.endsWith('/AGENTS.md') && f.path !== 'AGENTS.md');
  const results = [
    ...writeSkillFiles(repoPath, directWriteFiles, { force: true }),
    ...writeTransformedFiles(repoPath, dirScopedFiles, { force: true }),
  ];

  console.log();
  for (const result of results) {
    const icon = result.status === 'overwritten' ? pc.yellow('~') : pc.green('+');
    console.log(`  ${icon} ${result.path}`);
  }

  // Step 8: Regenerate skill-rules.json
  const hookTarget = publishTargets.find(t => t.supportsHooks);
  if (hookTarget) {
    try {
      const hookSkillsDir = join(repoPath, hookTarget.skillsDir);
      const rules = extractRulesFromSkills(hookSkillsDir);
      writeFileSync(join(hookSkillsDir, 'skill-rules.json'), JSON.stringify(rules, null, 2) + '\n');
      p.log.info('Updated skill-rules.json');
    } catch { /* non-fatal */ }
  }

  console.log();
  p.outro(`${results.length} file(s) refreshed`);
}

/**
 * Convert a skill's activation patterns into a domain object
 * compatible with buildDomainContext().
 */
export function skillToDomain(skill) {
  const patterns = parseActivationPatterns(skill.content);
  const directories = new Set();
  const files = [];

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Glob pattern — extract directory prefix
      const dir = pattern.replace(/\/\*.*$/, '').replace(/\*.*$/, '');
      if (dir) directories.add(dir);
    } else {
      // Exact file path
      files.push(pattern);
      const dir = dirname(pattern);
      if (dir && dir !== '.') directories.add(dir);
    }
  }

  return {
    name: skill.name,
    directories: [...directories],
    files,
  };
}
