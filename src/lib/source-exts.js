/**
 * Canonical set of source-file extensions recognized by the scanner and
 * context-builder. Keep in sync with `detectLanguages()` indicators in
 * `scanner.js` when adding a language.
 *
 * Note: `graph-builder.js` keeps its own smaller set because it only parses
 * JS/TS/Python imports.
 */
export const SOURCE_EXTS = new Set([
  '.py',
  '.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs',
  '.rb', '.go', '.rs',
  '.java', '.kt', '.kts',
  '.cs', '.fs', '.fsx',
  '.swift',
  '.php',
  '.ex', '.exs',
]);
