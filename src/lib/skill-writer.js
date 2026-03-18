import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Write parsed skill files to the target repo.
 * Takes an array of { path, content } objects.
 */
export function writeSkillFiles(repoPath, files, options = {}) {
  const { dryRun = false, force = false } = options;
  const results = [];

  for (const file of files) {
    const fullPath = join(repoPath, file.path);
    const exists = existsSync(fullPath);

    if (dryRun) {
      const action = exists && !force ? 'would-skip' : exists ? 'would-overwrite' : 'would-create';
      results.push({ path: file.path, status: action, content: file.content });
      continue;
    }

    if (exists && !force) {
      results.push({ path: file.path, status: 'skipped', reason: 'already exists (use --force to overwrite)' });
      continue;
    }

    // Create directories
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf8');
    results.push({ path: file.path, status: exists ? 'overwritten' : 'created' });
  }

  return results;
}
