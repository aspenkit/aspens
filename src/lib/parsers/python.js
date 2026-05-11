/**
 * Python parser — extracts top-level imports and exports (def/class).
 *
 * Regex-based by design (Q3): line-anchored, top-level only. SCREAMING_SNAKE
 * constants are intentionally excluded — they rarely act as import targets and
 * produce false positives that would flow into code-map.
 */

const PY_FROM_IMPORT_RE = /^from\s+(\.+[\w.]*|[\w.]+)\s+import\s+/gm;
const PY_IMPORT_RE = /^import\s+([\w.]+)/gm;

// Top-level only — no leading whitespace allowed.
const PY_DEF_RE = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm;
const PY_CLASS_RE = /^class\s+([A-Za-z_]\w*)/gm;

/**
 * Strip triple-quoted strings to avoid matching imports/defs inside docstrings.
 */
function stripTripleQuoted(content) {
  return content.replace(/('{3}|"{3})[\s\S]*?\1/g, '');
}

/**
 * Extract top-level Python imports (both `import x` and `from x import y` forms).
 * Relative imports (`.`, `..foo`) are returned verbatim — resolution happens upstream.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function parsePyImports(content) {
  const imports = [];
  const stripped = stripTripleQuoted(content);
  let match;

  PY_FROM_IMPORT_RE.lastIndex = 0;
  while ((match = PY_FROM_IMPORT_RE.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  PY_IMPORT_RE.lastIndex = 0;
  while ((match = PY_IMPORT_RE.exec(stripped)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Extract top-level Python exports — function and class names defined at
 * module scope. Methods inside classes are skipped (line-anchored regex
 * rejects any leading whitespace).
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractPythonExports(content) {
  const names = new Set();
  const stripped = stripTripleQuoted(content);
  let match;

  PY_DEF_RE.lastIndex = 0;
  while ((match = PY_DEF_RE.exec(stripped)) !== null) {
    names.add(match[1]);
  }

  PY_CLASS_RE.lastIndex = 0;
  while ((match = PY_CLASS_RE.exec(stripped)) !== null) {
    names.add(match[1]);
  }

  return [...names];
}
