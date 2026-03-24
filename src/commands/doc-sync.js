import { resolve, join, relative, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles, extractRulesFromSkills } from '../lib/skill-writer.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { persistGraphArtifacts, loadGraph, extractSubgraph, formatNavigationContext } from '../lib/graph-persistence.js';
import { findSkillFiles, parseActivationPatterns } from '../lib/skill-reader.js';
import { buildDomainContext, buildBaseContext } from '../lib/context-builder.js';
import { CliError } from '../lib/errors.js';
import { resolveTimeout } from '../lib/timeout.js';

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
    affectedSkills.some(skill => {
      const block = (skill.content.match(/## Activation[\s\S]*?---/) || [''])[0].toLowerCase();
      const name = f.toLowerCase().split('/').pop();
      if (block.includes(name)) return true;
      const segs = f.toLowerCase().split('/').filter(seg => !GENERIC_PATH_SEGMENTS.has(seg) && seg.length > 2);
      return segs.some(seg => block.includes(seg));
    })
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
    throw new CliError(err.message);
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

// --- Git helpers ---

function isGitRepo(repoPath) {
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getGitDiff(repoPath, commits) {
  // Try requested commit count, fall back to fewer
  for (let n = commits; n >= 1; n--) {
    try {
      const diff = execSync(`git diff HEAD~${n}..HEAD`, {
        cwd: repoPath,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { diff, actualCommits: n };
    } catch {
      continue;
    }
  }
  return { diff: '', actualCommits: 0 };
}

function getGitLog(repoPath, commits) {
  try {
    return execSync(`git log --oneline -${commits}`, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function getChangedFiles(repoPath, commits) {
  try {
    const output = execSync(`git diff --name-only HEAD~${commits}..HEAD`, {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
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

// Path segments too generic to use for skill matching
const GENERIC_PATH_SEGMENTS = new Set([
  'src', 'app', 'lib', 'api', 'v1', 'v2', 'components', 'services',
  'utils', 'helpers', 'common', 'core', 'config', 'middleware',
  'models', 'types', 'hooks', 'pages', 'routes', 'tests', 'test',
  'public', 'assets', 'styles', 'scripts',
]);

function mapChangesToSkills(changedFiles, existingSkills, scan, repoGraph = null) {
  const affected = [];

  for (const skill of existingSkills) {
    if (skill.name === 'base') continue; // base handled separately below

    // Extract file paths and specific names from the activation section
    const activationMatch = skill.content.match(/## Activation[\s\S]*?---/);
    if (!activationMatch) continue;

    const activationBlock = activationMatch[0].toLowerCase();

    let isAffected = changedFiles.some(file => {
      const fileLower = file.toLowerCase();
      // Check the filename itself (e.g., billing_service.py)
      const fileName = fileLower.split('/').pop();
      if (activationBlock.includes(fileName)) return true;

      // Check meaningful path segments (skip generic ones)
      const segs = fileLower.split('/').filter(seg => !GENERIC_PATH_SEGMENTS.has(seg) && seg.length > 2);
      return segs.some(seg => activationBlock.includes(seg));
    });

    // Graph-aware: check if changed files are imported by files in this skill's domain
    if (!isAffected && repoGraph) {
      isAffected = changedFiles.some(file => {
        const info = repoGraph.files[file];
        if (!info) return false;
        // Check if any file that imports the changed file matches the activation block
        return (info.importedBy || []).some(dep => {
          const depLower = dep.toLowerCase();
          const depName = depLower.split('/').pop();
          if (activationBlock.includes(depName)) return true;
          const segs = depLower.split('/').filter(seg => !GENERIC_PATH_SEGMENTS.has(seg) && seg.length > 2);
          return segs.some(seg => activationBlock.includes(seg));
        });
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
function skillToDomain(skill) {
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

// --- Git hook ---

function resolveAspensPath() {
  const cmd = process.platform === 'win32' ? 'where aspens' : 'which aspens';
  try {
    const resolved = execSync(cmd, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch { /* not in PATH */ }
  return 'npx aspens';
}

export function installGitHook(repoPath) {
  const hookDir = join(repoPath, '.git', 'hooks');
  const hookPath = join(hookDir, 'post-commit');

  if (!existsSync(join(repoPath, '.git'))) {
    throw new CliError('Not a git repository.');
  }

  mkdirSync(hookDir, { recursive: true });

  const aspensCmd = resolveAspensPath();

  const hookBlock = `
# >>> aspens doc-sync hook (do not edit) >>>
__aspens_doc_sync() {
  REPO_ROOT="\$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  REPO_HASH="\$(echo "\$REPO_ROOT" | (shasum 2>/dev/null || sha1sum 2>/dev/null || md5sum 2>/dev/null) | cut -c1-8)"
  ASPENS_LOCK="/tmp/aspens-sync-\${REPO_HASH}.lock"
  ASPENS_LOG="/tmp/aspens-sync-\${REPO_HASH}.log"

  # Skip aspens-only commits (skills, CLAUDE.md, graph artifacts)
  CHANGED="\$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)"
  NON_ASPENS="\$(echo "\$CHANGED" | grep -v '^\.claude/' | grep -v '^CLAUDE\.md\$' || true)"
  if [ -z "\$NON_ASPENS" ]; then
    return 0
  fi

  # Cooldown: skip if last sync was less than 5 minutes ago
  if [ -f "\$ASPENS_LOCK" ]; then
    LAST_RUN=\$(cat "\$ASPENS_LOCK" 2>/dev/null || echo 0)
    NOW=\$(date +%s)
    if [ \$((NOW - LAST_RUN)) -lt 300 ]; then
      return 0
    fi
  fi
  echo \$(date +%s) > "\$ASPENS_LOCK"

  # Clean up stale lock files older than 1 hour
  find /tmp -maxdepth 1 -name "aspens-sync-*.lock" -mmin +60 -delete 2>/dev/null

  # Truncate log if over 200 lines
  if [ -f "\$ASPENS_LOG" ] && [ "\$(wc -l < "\$ASPENS_LOG" 2>/dev/null || echo 0)" -gt 200 ]; then
    tail -100 "\$ASPENS_LOG" > "\$ASPENS_LOG.tmp" && mv "\$ASPENS_LOG.tmp" "\$ASPENS_LOG"
  fi

  # Run fully detached so git returns immediately (POSIX-compatible — no disown needed)
  (echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') started" >> "\$ASPENS_LOG" && ${aspensCmd} doc sync --commits 1 "\$REPO_ROOT" >> "\$ASPENS_LOG" 2>&1; echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') finished (exit \$?)" >> "\$ASPENS_LOG") </dev/null >/dev/null 2>&1 &
}
__aspens_doc_sync
# <<< aspens doc-sync hook <<<
`;

  // Check for existing hook
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes('aspens doc-sync hook') || existing.includes('aspens doc sync')) {
      console.log(pc.yellow('\n  Hook already installed.\n'));
      return;
    }
    // Append to existing hook (outside shebang)
    writeFileSync(hookPath, existing + '\n' + hookBlock, 'utf8');
    console.log(pc.green('\n  Appended aspens doc-sync to existing post-commit hook.\n'));
  } else {
    writeFileSync(hookPath, '#!/bin/sh\n' + hookBlock, 'utf8');
    execSync(`chmod +x "${hookPath}"`);
    console.log(pc.green('\n  Installed post-commit hook.\n'));
  }

  console.log(pc.dim('  Skills will auto-update after every commit.'));
  console.log(pc.dim('  Log: /tmp/aspens-sync-*.log'));
  console.log(pc.dim('  Remove with: aspens doc sync --remove-hook\n'));
}

export function removeGitHook(repoPath) {
  const hookPath = join(repoPath, '.git', 'hooks', 'post-commit');

  if (!existsSync(hookPath)) {
    console.log(pc.yellow('\n  No post-commit hook found.\n'));
    return;
  }

  const content = readFileSync(hookPath, 'utf8');
  const hasMarkers = content.includes('# >>> aspens doc-sync hook');
  const hasLegacy = !hasMarkers && content.includes('aspens doc sync');

  if (!hasMarkers && !hasLegacy) {
    console.log(pc.yellow('\n  Post-commit hook does not contain aspens.\n'));
    return;
  }

  if (hasMarkers) {
    const cleaned = content
      .replace(/\n?# >>> aspens doc-sync hook \(do not edit\) >>>[\s\S]*?# <<< aspens doc-sync hook <<<\n?/, '')
      .trim();

    if (!cleaned || cleaned === '#!/bin/sh') {
      unlinkSync(hookPath);
      console.log(pc.green('\n  Removed post-commit hook.\n'));
    } else {
      writeFileSync(hookPath, cleaned + '\n', 'utf8');
      console.log(pc.green('\n  Removed aspens doc-sync from post-commit hook.\n'));
    }
  } else {
    console.log(pc.yellow('\n  Legacy aspens hook detected (no removal markers).'));
    console.log(pc.dim('  Re-install first: aspens doc sync --install-hook'));
    console.log(pc.dim('  Or edit manually: .git/hooks/post-commit\n'));
  }
}

// --- Helpers ---

// Build a diff from a user-selected subset of files
function getSelectedFilesDiff(repoPath, files, commits) {
  try {
    const result = execFileSync('git', ['diff', `HEAD~${commits}..HEAD`, '--', ...files], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    return truncateDiff(result, 80000);
  } catch {
    return '';
  }
}

// Build a diff that puts skill-relevant files first so they survive truncation.
// Relevant files get 60k, everything else gets 20k (80k total).
function buildPrioritizedDiff(fullDiff, relevantFiles) {
  const MAX_CHARS = 80000;
  if (fullDiff.length <= MAX_CHARS || relevantFiles.length === 0) {
    return truncateDiff(fullDiff, MAX_CHARS);
  }

  // Split full diff into per-file chunks
  const chunks = [];
  const parts = fullDiff.split(/(?=^diff --git )/m);
  for (const part of parts) {
    const m = part.match(/^diff --git a\/(.*?) b\//m);
    chunks.push({ file: m ? m[1] : '', text: part });
  }

  // Separate relevant from other chunks
  const relevantSet = new Set(relevantFiles);
  const relevant = chunks.filter(c => relevantSet.has(c.file));
  const others = chunks.filter(c => !relevantSet.has(c.file));

  // Relevant files get the bulk of the budget; others get a smaller slice
  const relevantDiff = truncateDiff(relevant.map(c => c.text).join(''), 60000);
  const otherDiff = truncateDiff(others.map(c => c.text).join(''), 20000);

  return (relevantDiff + (otherDiff ? '\n' + otherDiff : '')).trim();
}

function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return diff;
  // Cut at the last complete diff hunk boundary to avoid mid-line truncation
  const truncated = diff.slice(0, maxChars);
  const lastHunkBoundary = truncated.lastIndexOf('\ndiff --git');
  const cutPoint = lastHunkBoundary > 0 ? lastHunkBoundary : maxChars;
  return diff.slice(0, cutPoint) + `\n\n... (diff truncated — use Read tool to see full files)`;
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
}
