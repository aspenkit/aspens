import { execFileSync } from 'child_process';

export function getGitRoot(repoPath) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(repoPath) {
  return !!getGitRoot(repoPath);
}

export function getGitDiff(repoPath, commits) {
  // Try requested commit count, fall back to fewer
  for (let n = commits; n >= 1; n--) {
    try {
      const diff = execFileSync('git', ['diff', `HEAD~${n}..HEAD`], {
        cwd: repoPath,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      return { diff, actualCommits: n };
    } catch {
      continue;
    }
  }
  return { diff: '', actualCommits: 0 };
}

export function getGitLog(repoPath, commits) {
  try {
    return execFileSync('git', ['log', '--oneline', `-${commits}`], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
}

export function getChangedFiles(repoPath, commits) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `HEAD~${commits}..HEAD`], {
      cwd: repoPath,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15000,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
