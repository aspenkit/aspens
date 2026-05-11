/**
 * diff-classifier — change classification (vs diff-helpers, which shapes diffs).
 *
 * This module owns predicates that answer "what KIND of change is this?" so
 * the doc-sync pipeline can decide whether a commit needs an LLM call at all.
 *
 * Layering: leaf module. graph-builder imports LOCK_FILES from here; nothing
 * here imports from graph-builder. Future home for `isFormattingOnlyDiff`,
 * `isCommentOnlyDiff`, etc.
 */

import { extname, basename } from 'path';

/**
 * Filenames that represent dependency lockfiles. Edits to these files alone
 * never warrant a doc-sync (the source of truth — the manifest — drives sync,
 * not the resolved lock).
 */
export const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'go.sum',
  'composer.lock', 'Pipfile.lock',
]);

/**
 * File extensions that may carry application logic worth re-evaluating.
 * Anything outside this set is considered non-code-bearing for sync purposes.
 */
const CODE_BEARING_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift',
]);

/**
 * Returns true when the changed file set is "no-op" for doc-sync purposes:
 * - Every file is a known lockfile (e.g. dependency bump only), OR
 * - No file has a code-bearing extension (e.g. only docs/configs touched).
 *
 * Skipping the LLM call entirely on these diffs is the changetype filter
 * that paired with the prompt churn-suppression rules forms Phase 1's noise
 * floor.
 *
 * @param {string[]} changedFiles - paths relative to the repo root
 * @returns {boolean}
 */
export function isNoOpDiff(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return true;

  const allLockFiles = changedFiles.every(file => LOCK_FILES.has(basename(file)));
  if (allLockFiles) return true;

  const anyCodeBearing = changedFiles.some(file => CODE_BEARING_EXTS.has(extname(file)));
  if (!anyCodeBearing) return true;

  return false;
}
