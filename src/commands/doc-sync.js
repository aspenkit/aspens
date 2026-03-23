import { resolve, join, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles } from '../lib/skill-writer.js';
import { buildRepoGraph } from '../lib/graph-builder.js';
import { persistGraphArtifacts, loadGraph, extractSubgraph, formatNavigationContext } from '../lib/graph-persistence.js';
import { CliError } from '../lib/errors.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

export async function docSyncCommand(path, options) {
  const repoPath = resolve(path);
  const timeoutMs = (typeof options.timeout === 'number' ? options.timeout : 300) * 1000;
  const verbose = !!options.verbose;
  const commits = typeof options.commits === 'number' ? options.commits : 1;

  // Install/remove hook mode
  if (options.installHook) {
    return installGitHook(repoPath);
  }
  if (options.removeHook) {
    return removeGitHook(repoPath);
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

  // Step 4: Build prompt
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = loadPrompt('doc-sync');

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
${truncateDiff(diff, 15000)}
\`\`\`

## Changed Files
${changedFiles.join('\n')}
${graphContext ? `\n## Import Graph Context\n${graphContext}` : ''}
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
  for (const result of results) {
    const icon = result.status === 'overwritten' ? pc.yellow('~') : pc.green('+');
    console.log(`  ${icon} ${result.path}`);
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
  const skills = [];

  if (!existsSync(skillsDir)) return skills;

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkDir(full);
        } else if (entry === 'skill.md' || entry.endsWith('.md')) {
          const content = readFileSync(full, 'utf8');
          const nameMatch = content.match(/name:\s*(.+)/);
          const relativePath = relative(repoPath, full);
          skills.push({
            name: nameMatch ? nameMatch[1].trim() : entry,
            path: relativePath,
            content,
          });
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkDir(skillsDir);
  return skills;
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
      const parts = fileLower.split('/').filter(p => !GENERIC_PATH_SEGMENTS.has(p) && p.length > 2);
      return parts.some(part => activationBlock.includes(part));
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
          const parts = depLower.split('/').filter(p => !GENERIC_PATH_SEGMENTS.has(p) && p.length > 2);
          return parts.some(part => activationBlock.includes(part));
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

  # Run in background with logging
  (echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') started" >> "\$ASPENS_LOG" && ${aspensCmd} doc sync --commits 1 "\$REPO_ROOT" >> "\$ASPENS_LOG" 2>&1; echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') finished (exit \$?)" >> "\$ASPENS_LOG") &
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
