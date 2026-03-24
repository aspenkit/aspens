import { execFileSync } from 'child_process';

export function isGitRepo(repoPath) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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
