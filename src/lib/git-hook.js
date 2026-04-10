import { join, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from 'fs';
import { execSync } from 'child_process';
import pc from 'picocolors';
import { CliError } from './errors.js';
import { getGitRoot } from './git-helpers.js';

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
  const gitRoot = getGitRoot(repoPath);
  if (!gitRoot) {
    throw new CliError('Not a git repository.');
  }

  const projectRelative = toPosixRelative(gitRoot, repoPath);
  const projectLabel = projectRelative || '.';
  const projectSlug = projectRelative
    ? projectRelative.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : 'root';
  const generatedPrefix = projectRelative ? `${projectRelative}/` : '';
  const projectPathExpr = projectRelative ? `"\${REPO_ROOT}/${projectRelative}"` : '"${REPO_ROOT}"';
  const scopePrefix = projectRelative ? `grep '^${escapeForSingleQuotes(projectRelative)}/' | ` : '';

  const hookDir = join(gitRoot, '.git', 'hooks');
  const hookPath = join(hookDir, 'post-commit');
  mkdirSync(hookDir, { recursive: true });

  const aspensCmd = resolveAspensPath();

  const hookBlock = `
# >>> aspens doc-sync hook (${projectLabel}) (do not edit) >>>
__aspens_doc_sync_${projectSlug}() {
  REPO_ROOT="\$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  PROJECT_PATH=${projectPathExpr}
  REPO_HASH="\$(printf '%s' "\$PROJECT_PATH" | (shasum 2>/dev/null || sha1sum 2>/dev/null || md5sum 2>/dev/null) | cut -c1-8)"
  ASPENS_LOCK="/tmp/aspens-sync-\${REPO_HASH}.lock"
  ASPENS_LOG="/tmp/aspens-sync-\${REPO_HASH}.log"

  # Skip aspens-only commits (skills, CLAUDE.md, AGENTS.md, graph artifacts)
  CHANGED="\$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)"
  NON_ASPENS="\$(echo "\$CHANGED" | ${scopePrefix}grep -v '^${generatedPrefix}\\.claude/' | grep -v '^${generatedPrefix}\\.codex/' | grep -v '^${generatedPrefix}\\.agents/' | grep -v '^${generatedPrefix}CLAUDE\\.md\$' | grep -v '^${generatedPrefix}AGENTS\\.md\$' | grep -v '^${generatedPrefix}.*\\/AGENTS\\.md\$' | grep -v '^${generatedPrefix}\\.aspens\\.json\$' || true)"
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
  find /tmp -maxdepth 1 -name "aspens-sync-*.lock" -mmin +60 -exec rm -f {} \\; 2>/dev/null

  # Truncate log if over 200 lines
  if [ -f "\$ASPENS_LOG" ] && [ "\$(wc -l < "\$ASPENS_LOG" 2>/dev/null || echo 0)" -gt 200 ]; then
    tail -100 "\$ASPENS_LOG" > "\$ASPENS_LOG.tmp" && mv "\$ASPENS_LOG.tmp" "\$ASPENS_LOG"
  fi

  # Run fully detached so git returns immediately (POSIX-compatible — no disown needed)
  (echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') started (${projectLabel})" >> "\$ASPENS_LOG" && ${aspensCmd} doc sync --commits 1 "\$PROJECT_PATH" >> "\$ASPENS_LOG" 2>&1; echo "[sync] \$(date '+%Y-%m-%d %H:%M:%S') finished (exit \$?)" >> "\$ASPENS_LOG") </dev/null >/dev/null 2>&1 &
}
__aspens_doc_sync_${projectSlug}
# <<< aspens doc-sync hook (${projectLabel}) <<<
`;

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes(`# >>> aspens doc-sync hook (${projectLabel})`)) {
      console.log(pc.yellow(`\n  Hook already installed for ${projectLabel}.\n`));
      return;
    }
    if (hasUnlabeledAspensBlock(existing)) {
      writeFileSync(hookPath, existing.replace(buildUnlabeledMarkerRegex(), '\n' + hookBlock).trim() + '\n', 'utf8');
      console.log(pc.green(`\n  Upgraded aspens doc-sync hook for ${projectLabel}.\n`));
      return;
    }
    writeFileSync(hookPath, existing + '\n' + hookBlock, 'utf8');
    console.log(pc.green(`\n  Appended aspens doc-sync for ${projectLabel} to existing post-commit hook.\n`));
  } else {
    writeFileSync(hookPath, '#!/bin/sh\n' + hookBlock, 'utf8');
    chmodSync(hookPath, 0o755);
    console.log(pc.green(`\n  Installed post-commit hook for ${projectLabel}.\n`));
  }

  console.log(pc.dim('  Skills will auto-update after every commit.'));
  console.log(pc.dim('  Log: /tmp/aspens-sync-*.log'));
  console.log(pc.dim('  Remove with: aspens doc sync --remove-hook\n'));
}

export function removeGitHook(repoPath) {
  const gitRoot = getGitRoot(repoPath);
  if (!gitRoot) {
    console.log(pc.yellow('\n  No post-commit hook found.\n'));
    return;
  }

  const projectLabel = toPosixRelative(gitRoot, repoPath) || '.';
  const hookPath = join(gitRoot, '.git', 'hooks', 'post-commit');

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
    const cleaned = content.replace(buildMarkerRegex(projectLabel), '').trim();

    if (cleaned === content.trim()) {
      console.log(pc.yellow(`\n  No aspens hook found for ${projectLabel}.\n`));
      return;
    }

    if (!cleaned || cleaned === '#!/bin/sh') {
      unlinkSync(hookPath);
      console.log(pc.green(`\n  Removed post-commit hook for ${projectLabel}.\n`));
    } else {
      writeFileSync(hookPath, cleaned + '\n', 'utf8');
      console.log(pc.green(`\n  Removed aspens doc-sync for ${projectLabel} from post-commit hook.\n`));
    }
  } else {
    console.log(pc.yellow('\n  Legacy aspens hook detected (no removal markers).'));
    console.log(pc.dim('  Re-install first: aspens doc sync --install-hook'));
    console.log(pc.dim('  Or edit manually: .git/hooks/post-commit\n'));
  }
}

function toPosixRelative(from, to) {
  const rel = relative(from, to);
  if (!rel || rel === '.') return '';
  return rel.split('\\').join('/');
}

function escapeForSingleQuotes(value) {
  return value.replace(/'/g, `'\\''`);
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMarkerRegex(projectLabel) {
  const escaped = escapeForRegex(projectLabel);
  return new RegExp(
    `\\n?# >>> aspens doc-sync hook \\(${escaped}\\) \\(do not edit\\) >>>[\\s\\S]*?# <<< aspens doc-sync hook \\(${escaped}\\) <<<\\n?`
  );
}

function hasUnlabeledAspensBlock(content) {
  return content.includes('# >>> aspens doc-sync hook (do not edit) >>>');
}

function buildUnlabeledMarkerRegex() {
  return /\n?# >>> aspens doc-sync hook \(do not edit\) >>>[\s\S]*?# <<< aspens doc-sync hook <<</;
}
