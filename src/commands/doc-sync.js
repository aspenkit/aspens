import { resolve, join, relative, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles, extractRulesFromSkills } from '../lib/skill-writer.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { persistGraphArtifacts, loadGraph, extractSubgraph, formatNavigationContext } from '../lib/graph-persistence.js';
import { findSkillFiles, parseActivationPatterns, getActivationBlock, fileMatchesActivation } from '../lib/skill-reader.js';
import { buildDomainContext, buildBaseContext } from '../lib/context-builder.js';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';
import { installGitHook, removeGitHook } from '../lib/git-hook.js';
import { isGitRepo, getGitDiff, getGitLog, getChangedFiles } from '../lib/git-helpers.js';
import { getSelectedFilesDiff, buildPrioritizedDiff, truncate } from '../lib/diff-helpers.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const PARALLEL_LIMIT = 3;

export async function docSyncCommand(path, options) {
  const repoPath = resolve(path);
  const verbose = !!options.verbose;
  const commits = typeof options.commits === 'number' ? options.commits : 1;

  // Install/remove hook mode
  if (options.installHook) {
    return installGitHook(repoPath);
  }
  if (options.removeHook) {
    return removeGitHook(repoPath);
  }

  // Refresh mode — skip diff, review all skills against current codebase
  if (options.refresh) {
    return refreshAllSkills(repoPath, options);
  }

  p.intro(pc.cyan('aspens doc sync'));

  // Step 1: Check prerequisites
  if (!isGitRepo(repoPath)) {
    throw new CliError('Not a git repository. doc sync requires git history.');
  }

  if (!existsSync(join(repoPath, '.claude', 'skills'))) {
    throw new CliError('No .claude/skills/ found. Run aspens doc init first.');
  }

  // Step 2: Get git diff
  const diffSpinner = p.spinner();
  diffSpinner.start(`Reading last ${commits} commit(s)...`);

  const { diff, actualCommits } = getGitDiff(repoPath, commits);
  if (actualCommits < commits) {
    diffSpinner.message(`Only ${actualCommits} commit(s) available (requested ${commits})`);
  }
  const commitLog = getGitLog(repoPath, actualCommits);

  if (!diff.trim()) {
    diffSpinner.stop('No changes found');
    p.outro('Nothing to sync');
    return;
  }

  const changedFiles = getChangedFiles(repoPath, actualCommits);
  diffSpinner.stop(`${changedFiles.length} files changed`);

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
  const existingSkills = findExistingSkills(repoPath);

  // Rebuild graph from current state (keeps graph fresh on every sync)
  let repoGraph = null;
  let graphContext = '';
  try {
    const rawGraph = await buildRepoGraph(repoPath, scan.languages);
    persistGraphArtifacts(repoPath, rawGraph);
    repoGraph = loadGraph(repoPath);
    if (repoGraph) {
      const subgraph = extractSubgraph(repoGraph, changedFiles);
      graphContext = formatNavigationContext(subgraph);
    }
  } catch (err) {
    p.log.warn(`Graph context unavailable — proceeding without it. (${err.message})`);
  }

  const affectedSkills = mapChangesToSkills(changedFiles, existingSkills, scan, repoGraph);

  if (affectedSkills.length > 0) {
    p.log.info(`Skills that may need updates: ${affectedSkills.map(s => pc.yellow(s.name)).join(', ')}`);
  } else {
    p.log.info('No skills directly affected, but Claude will check for structural changes.');
  }

  // Timeout priority: --timeout flag > ASPENS_TIMEOUT env var > auto-scaled default
  const autoTimeout = Math.min(300 + affectedSkills.length * 60, 900);
  const { timeoutMs, envWarning } = resolveTimeout(options.timeout, autoTimeout);
  if (envWarning) p.log.warn('ASPENS_TIMEOUT is not a valid number — using auto-scaled timeout.');

  // Step 4: Build prompt
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-sync');

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
    selectedFiles = picked;
  }

  // Build diff from selected files only, or use full prioritized diff
  let activeDiff;
  if (selectedFiles.length < changedFiles.length) {
    activeDiff = getSelectedFilesDiff(repoPath, selectedFiles, actualCommits);
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

  const claudeMdContent = existsSync(join(repoPath, 'CLAUDE.md'))
    ? readFileSync(join(repoPath, 'CLAUDE.md'), 'utf8')
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

## Existing CLAUDE.md
\`\`\`
${truncate(claudeMdContent, 5000)}
\`\`\``;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

  // Step 5: Run Claude
  const syncSpinner = p.spinner();
  syncSpinner.start('Analyzing changes and updating skills...');

  let result;
  try {
    result = await runClaude(fullPrompt, {
      timeout: timeoutMs,
      allowedTools: READ_ONLY_TOOLS,
      verbose,
      model: options.model || null,
      onActivity: verbose ? (msg) => syncSpinner.message(pc.dim(msg)) : null,
    });
  } catch (err) {
    syncSpinner.stop(pc.red('Failed'));
    throw new CliError(err.message, { cause: err });
  }

  // Step 6: Parse output
  const files = parseFileOutput(result.text);

  if (files.length === 0) {
    syncSpinner.stop('No updates needed');
    p.outro('Skills are up to date');
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
  const results = writeSkillFiles(repoPath, files, { force: true });

  console.log();
  for (const wr of results) {
    const icon = wr.status === 'overwritten' ? pc.yellow('~') : pc.green('+');
    console.log(`  ${icon} ${wr.path}`);
  }

  console.log();
  p.outro(`${results.length} file(s) updated`);
}

// --- Skill mapping ---

function findExistingSkills(repoPath) {
  const skillsDir = join(repoPath, '.claude', 'skills');
  return findSkillFiles(skillsDir).map(s => ({
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

async function refreshAllSkills(repoPath, options) {
  const verbose = !!options.verbose;

  p.intro(pc.cyan('aspens doc sync --refresh'));

  // Prerequisites
  if (!isGitRepo(repoPath)) {
    throw new CliError('Not a git repository.');
  }
  const skillsDir = join(repoPath, '.claude', 'skills');
  if (!existsSync(skillsDir)) {
    throw new CliError('No .claude/skills/ found. Run aspens doc init first.');
  }

  // Step 1: Scan + graph
  const scanSpinner = p.spinner();
  scanSpinner.start('Scanning repo and building import graph...');

  const scan = scanRepo(repoPath);
  try {
    const rawGraph = await buildRepoGraph(repoPath, scan.languages);
    persistGraphArtifacts(repoPath, rawGraph);
  } catch (err) {
    p.log.warn(`Graph build failed — continuing without it. (${err.message})`);
  }

  scanSpinner.stop('Scan complete');

  // Step 2: Load existing skills
  const existingSkills = findExistingSkills(repoPath);
  if (existingSkills.length === 0) {
    throw new CliError('No skills found in .claude/skills/. Run aspens doc init first.');
  }

  const baseSkill = existingSkills.find(s => s.name === 'base');
  const domainSkills = existingSkills.filter(s => s.name !== 'base');

  p.log.info(`Found ${existingSkills.length} skill(s): ${existingSkills.map(s => pc.cyan(s.name)).join(', ')}`);

  // Timeout: --timeout flag > ASPENS_TIMEOUT env > auto-scaled
  const autoTimeout = Math.min(120 + existingSkills.length * 60, 900);
  const { timeoutMs: perSkillTimeout } = resolveTimeout(options.timeout, autoTimeout);

  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-sync-refresh');
  const allUpdatedFiles = [];

  // Step 3: Refresh base skill first
  if (baseSkill) {
    const baseSpinner = p.spinner();
    baseSpinner.start('Refreshing base skill...');

    try {
      const baseContext = buildBaseContext(repoPath, scan);
      const prompt = `${systemPrompt}\n\n---\n\nRepository path: ${repoPath}\nToday's date: ${today}\n\n## Existing Skill\n\`\`\`\n${baseSkill.content}\n\`\`\`\n\n## Current Codebase\n${baseContext}`;

      const result = await runClaude(prompt, {
        timeout: perSkillTimeout,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        model: options.model || null,
        onActivity: verbose ? (msg) => baseSpinner.message(pc.dim(msg)) : null,
      });

      const files = parseFileOutput(result.text);
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

          const result = await runClaude(prompt, {
            timeout: perSkillTimeout,
            allowedTools: READ_ONLY_TOOLS,
            verbose,
            model: options.model || null,
            onActivity: verbose ? (msg) => skillSpinner.message(pc.dim(msg)) : null,
          });

          const files = parseFileOutput(result.text);
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

  // Step 5: Refresh CLAUDE.md if it exists
  const claudeMdPath = join(repoPath, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    const claudeSpinner = p.spinner();
    claudeSpinner.start('Checking CLAUDE.md...');

    try {
      const claudeMd = readFileSync(claudeMdPath, 'utf8');
      const skillSummaries = existingSkills.map(s => {
        const descMatch = s.content.match(/description:\s*(.+)/);
        return `- **${s.name}**: ${descMatch ? descMatch[1].trim() : ''}`;
      }).join('\n');

      const claudePrompt = `${systemPrompt}\n\n---\n\nRepository path: ${repoPath}\nToday's date: ${today}\n\n## Existing Skill\n\`\`\`\n${claudeMd}\n\`\`\`\n\n## Installed Skills\n${skillSummaries}\n\n## Current Codebase\n${buildBaseContext(repoPath, scan)}`;

      const claudeResult = await runClaude(claudePrompt, {
        timeout: perSkillTimeout,
        allowedTools: READ_ONLY_TOOLS,
        verbose,
        model: options.model || null,
        onActivity: verbose ? (msg) => claudeSpinner.message(pc.dim(msg)) : null,
      });

      const claudeFiles = parseFileOutput(claudeResult.text);
      if (claudeFiles.length > 0) {
        allUpdatedFiles.push(...claudeFiles);
        claudeSpinner.stop(pc.yellow('CLAUDE.md') + ' — updated');
      } else {
        claudeSpinner.stop(pc.dim('CLAUDE.md') + ' — up to date');
      }
    } catch (err) {
      claudeSpinner.stop(pc.red('CLAUDE.md — failed: ') + err.message);
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

  const results = writeSkillFiles(repoPath, allUpdatedFiles, { force: true });

  console.log();
  for (const result of results) {
    const icon = result.status === 'overwritten' ? pc.yellow('~') : pc.green('+');
    console.log(`  ${icon} ${result.path}`);
  }

  // Step 8: Regenerate skill-rules.json
  try {
    const rules = extractRulesFromSkills(skillsDir);
    writeFileSync(join(skillsDir, 'skill-rules.json'), JSON.stringify(rules, null, 2) + '\n');
    p.log.info('Updated skill-rules.json');
  } catch { /* non-fatal */ }

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
