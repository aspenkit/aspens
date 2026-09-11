/**
 * CI/CD platform detector — deterministic, filesystem only.
 *
 * A platform is matched by any of three marker kinds:
 *   - `files` — exact filename, no extension (Jenkinsfile)
 *   - `stems` — filename without extension, combined with every CICD_EXT
 *   - `dirs`  — directory holding one or more CI config files
 *
 * Directory markers exist because a pipeline is rarely a single file: the
 * entry config usually sits alongside imported/included job files, and some
 * platforms name the entry file freely (`.github/workflows/*.yml`). Scanning
 * the directory catches those, including one level of nesting such as
 * `.buildkite/pipelines/deploy.yml`.
 *
 * Results follow PLATFORMS order, so they are stable across runs.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CICD_EXTS = ['.yml', '.yaml'];

const NESTED_SCAN_DEPTH = 2;

const PLATFORMS = [
  { id: 'github-actions', dirs: ['.github/workflows'] },
  { id: 'gitlab-ci', stems: ['.gitlab-ci'], dirs: ['.gitlab/ci'] },
  { id: 'circleci', dirs: ['.circleci'] },
  { id: 'jenkins', files: ['Jenkinsfile'] },
  { id: 'travis-ci', stems: ['.travis'] },
  { id: 'azure-pipelines', stems: ['azure-pipelines', '.azure-pipelines'] },
  { id: 'bitbucket-pipelines', stems: ['bitbucket-pipelines'] },
  { id: 'buildkite', dirs: ['.buildkite'] },
];

/**
 * Detect CI/CD platforms configured in a repo.
 *
 * @param {string} repoPath
 * @returns {string[]} platform ids, empty when none are configured
 */
export function detectCICD(repoPath) {
  const found = [];

  for (const platform of PLATFORMS) {
    if (matchesPlatform(repoPath, platform)) found.push(platform.id);
  }

  return found;
}

function matchesPlatform(repoPath, { files = [], stems = [], dirs = [] }) {
  if (files.some(file => existsSync(join(repoPath, file)))) return true;
  if (stems.some(stem => CICD_EXTS.some(ext => existsSync(join(repoPath, stem + ext))))) return true;
  return dirs.some(dir => hasConfigFile(join(repoPath, dir), NESTED_SCAN_DEPTH));
}

function hasConfigFile(dirPath, depth) {
  if (depth <= 0) return false;

  for (const entry of listDir(dirPath)) {
    if (CICD_EXTS.some(ext => entry.endsWith(ext))) return true;
    const full = join(dirPath, entry);
    if (isDir(full) && hasConfigFile(full, depth - 1)) return true;
  }

  return false;
}

function listDir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function isDir(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
