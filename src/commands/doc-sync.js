import { resolve, join, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanRepo } from '../lib/scanner.js';
import { runClaude, loadPrompt, parseFileOutput } from '../lib/runner.js';
import { writeSkillFiles } from '../lib/skill-writer.js';

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

export async function docSyncCommand(path, options) {
  const repoPath = resolve(path);
  const timeoutMs = parseInt(options.timeout) * 1000 || 300000;
  const verbose = !!options.verbose;
  const commits = parseInt(options.commits) || 1;

  // Install hook mode
  if (options.installHook) {
    return installGitHook(repoPath);
  }

  p.intro(pc.cyan('aspens doc sync'));

  // Step 1: Check prerequisites
  if (!isGitRepo(repoPath)) {
    p.log.error('Not a git repository. doc sync requires git history.');
    process.exit(1);
  }

  if (!existsSync(join(repoPath, '.claude', 'skills'))) {
    p.log.error('No .claude/skills/ found. Run aspens doc init first.');
    process.exit(1);
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
  const affectedSkills = mapChangesToSkills(changedFiles, existingSkills, scan);

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

  let output;
  try {
    output = await runClaude(fullPrompt, {
      timeout: timeoutMs,
      allowedTools: READ_ONLY_TOOLS,
      verbose,
      onActivity: verbose ? (msg) => syncSpinner.message(pc.dim(msg)) : null,
    });
  } catch (err) {
    syncSpinner.stop(pc.red('Failed'));
    p.log.error(err.message);
    process.exit(1);
  }

  // Step 6: Parse output
  const files = parseFileOutput(output);

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
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' });
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

function mapChangesToSkills(changedFiles, existingSkills, scan) {
  const affected = [];

  for (const skill of existingSkills) {
    if (skill.name === 'base') continue; // base handled separately below

    // Extract file paths and specific names from the activation section
    const activationMatch = skill.content.match(/## Activation[\s\S]*?---/);
    if (!activationMatch) continue;

    const activationBlock = activationMatch[0].toLowerCase();

    const isAffected = changedFiles.some(file => {
      const fileLower = file.toLowerCase();
      // Check the filename itself (e.g., billing_service.py)
      const fileName = fileLower.split('/').pop();
      if (activationBlock.includes(fileName)) return true;

      // Check meaningful path segments (skip generic ones)
      const parts = fileLower.split('/').filter(p => !GENERIC_PATH_SEGMENTS.has(p) && p.length > 2);
      return parts.some(part => activationBlock.includes(part));
    });

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

function installGitHook(repoPath) {
  const hookDir = join(repoPath, '.git', 'hooks');
  const hookPath = join(hookDir, 'post-commit');

  if (!existsSync(join(repoPath, '.git'))) {
    console.log(pc.red('\n  Not a git repository.\n'));
    process.exit(1);
  }

  mkdirSync(hookDir, { recursive: true });

  const hookCommand = `
# aspens doc sync — auto-update skills after commit
# Installed by: aspens doc sync --install-hook

# Run in background so commit isn't blocked
npx aspens doc sync --commits 1 "\$(git rev-parse --show-toplevel)" &
`;

  const hookFull = `#!/bin/sh${hookCommand}`;

  // Check for existing hook
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes('aspens doc sync')) {
      console.log(pc.yellow('\n  Hook already installed.\n'));
      return;
    }
    // Append command to existing hook (without shebang)
    writeFileSync(hookPath, existing + '\n' + hookCommand, 'utf8');
    console.log(pc.green('\n  Appended aspens doc sync to existing post-commit hook.\n'));
  } else {
    writeFileSync(hookPath, hookFull, 'utf8');
    execSync(`chmod +x "${hookPath}"`);
    console.log(pc.green('\n  Installed post-commit hook.\n'));
  }

  console.log(pc.dim('  Skills will auto-update after every commit.'));
  console.log(pc.dim('  Remove with: rm .git/hooks/post-commit\n'));
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
