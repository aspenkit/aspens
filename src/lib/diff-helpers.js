import { execFileSync } from 'child_process';

export function getSelectedFilesDiff(repoPath, files, commits) {
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
export function buildPrioritizedDiff(fullDiff, relevantFiles) {
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

export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return diff;
  // Cut at the last complete diff hunk boundary to avoid mid-line truncation
  const truncated = diff.slice(0, maxChars);
  const lastHunkBoundary = truncated.lastIndexOf('\ndiff --git');
  let cutPoint;
  if (lastHunkBoundary > 0) {
    cutPoint = lastHunkBoundary;
  } else {
    // No hunk boundary found — fall back to last newline to avoid mid-line cut
    const lastNewline = truncated.lastIndexOf('\n');
    cutPoint = lastNewline > 0 ? lastNewline : maxChars;
  }
  return diff.slice(0, cutPoint) + `\n\n... (diff truncated — use Read tool to see full files)`;
}

export function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... (truncated)';
}
