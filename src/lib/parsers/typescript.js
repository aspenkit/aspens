/**
 * TypeScript / JavaScript parser — wraps es-module-lexer with two extensions:
 *
 *   1. Default-export name resolution: es-module-lexer reports `e.n === 'default'`
 *      but doesn't expose the source identifier. We post-pass for inline default
 *      exports (`export default function Foo`, `export default class Bar`,
 *      `export default Baz`).
 *
 *   2. `export * from '...'` re-exports: lexer reports them as exports with
 *      no useful name. We emit a `re-export from <specifier>` synthetic entry
 *      so downstream graph traversal can follow the edge.
 *
 * Known limitation: `const Foo = ...; export default Foo` (reassignment
 * pattern) is detected only when the identifier is a single token — we then
 * grep backward for `const|let|var Foo =` and capture that name. If neither
 * pattern matches, the default export remains anonymous.
 */

import { init, parse } from 'es-module-lexer';

const DEFAULT_EXPORT_INLINE_RE =
  /export\s+default\s+(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[;\n])/g;

const REEXPORT_STAR_RE = /export\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s*['"]([^'"]+)['"]/g;

const VAR_DECL_RE_TEMPLATE = (name) =>
  new RegExp('(?:const|let|var)\\s+' + escapeRegex(name) + '\\s*[:=]', 'm');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a JS/TS file's imports + exports.
 * Returns { imports: string[], exports: string[] }.
 *
 * `imports` contains import specifiers (e.g. './foo', '@/lib/bar', 'react').
 * `exports` contains exported names. Each `export * from '<spec>'` adds a
 * synthetic entry of the form `re-export:<spec>` so callers can resolve the
 * downstream edge.
 *
 * @param {string} content
 * @param {string} relPath - for error reporting only
 * @returns {Promise<{imports: string[], exports: string[]}>}
 */
export async function parseJsImports(content, _relPath) {
  await init;
  const result = { imports: [], exports: [] };
  let lexerSucceeded = false;

  try {
    const [imports, exports] = parse(content);
    lexerSucceeded = true;

    for (const imp of imports) {
      if (imp.n) result.imports.push(imp.n);
    }

    for (const exp of exports) {
      if (!exp.n) continue;
      if (exp.n === 'default') {
        const resolved = resolveDefaultExportName(content);
        if (resolved) {
          result.exports.push(resolved);
        } else {
          result.exports.push('default');
        }
      } else {
        result.exports.push(exp.n);
      }
    }
  } catch {
    // es-module-lexer can't handle JSX in some files. Fall back to a
    // regex-based scan below so we still get usable export names.
  }

  if (!lexerSucceeded) {
    fallbackRegexExtract(content, result);
  }

  // `export * from` — synthetic re-export edges.
  // (es-module-lexer already records the import on success; either way we
  // add the synthetic marker so downstream code knows this is a re-export,
  // not a first-class export.)
  REEXPORT_STAR_RE.lastIndex = 0;
  const importsSet = new Set(result.imports);
  let m;
  while ((m = REEXPORT_STAR_RE.exec(content)) !== null) {
    const spec = m[1];
    result.exports.push(`re-export:${spec}`);
    if (!importsSet.has(spec)) {
      result.imports.push(spec);
      importsSet.add(spec);
    }
  }

  return result;
}

/**
 * Best-effort regex extraction used only when es-module-lexer fails (e.g.
 * JSX in a .tsx Next.js page). Catches `import ... from '...'`, `export
 * default function/class/identifier`, and named `export const/function/class`.
 *
 * Less precise than the lexer (no scope analysis, no template-string handling)
 * but lets graph coverage degrade gracefully on JSX-heavy code.
 */
const FALLBACK_IMPORT_RE = /^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
const FALLBACK_BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;
const FALLBACK_DEFAULT_FN_RE = /^\s*export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/m;
const FALLBACK_DEFAULT_CLASS_RE = /^\s*export\s+default\s+class\s+([A-Za-z_$][\w$]*)/m;
const FALLBACK_DEFAULT_IDENT_RE = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m;
const FALLBACK_NAMED_RE = /^\s*export\s+(?:async\s+)?(?:const|let|var|function\s*\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const FALLBACK_NAMED_LIST_RE = /^\s*export\s*\{([^}]+)\}/gm;

function fallbackRegexExtract(content, result) {
  let m;

  FALLBACK_IMPORT_RE.lastIndex = 0;
  while ((m = FALLBACK_IMPORT_RE.exec(content)) !== null) {
    result.imports.push(m[1]);
  }
  FALLBACK_BARE_IMPORT_RE.lastIndex = 0;
  while ((m = FALLBACK_BARE_IMPORT_RE.exec(content)) !== null) {
    if (!result.imports.includes(m[1])) result.imports.push(m[1]);
  }

  FALLBACK_NAMED_RE.lastIndex = 0;
  while ((m = FALLBACK_NAMED_RE.exec(content)) !== null) {
    result.exports.push(m[1]);
  }

  FALLBACK_NAMED_LIST_RE.lastIndex = 0;
  while ((m = FALLBACK_NAMED_LIST_RE.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/i).pop();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
        result.exports.push(name);
      }
    }
  }

  const fnMatch = content.match(FALLBACK_DEFAULT_FN_RE);
  if (fnMatch) {
    result.exports.push(fnMatch[1]);
  } else {
    const classMatch = content.match(FALLBACK_DEFAULT_CLASS_RE);
    if (classMatch) {
      result.exports.push(classMatch[1]);
    } else {
      const identMatch = content.match(FALLBACK_DEFAULT_IDENT_RE);
      if (identMatch) result.exports.push(identMatch[1]);
    }
  }
}

/**
 * Find the source identifier for a `default` export.
 * Handles inline forms (`export default function Foo`, `export default class Bar`)
 * directly. For the reassignment pattern (`const Foo = ...; export default Foo`)
 * we capture the identifier from the trailing `export default <name>` and rely
 * on its declaration appearing earlier in the file.
 *
 * Returns null if no name can be resolved.
 */
function resolveDefaultExportName(content) {
  DEFAULT_EXPORT_INLINE_RE.lastIndex = 0;
  let match;
  while ((match = DEFAULT_EXPORT_INLINE_RE.exec(content)) !== null) {
    // First capture group with content wins.
    const name = match[1] || match[2] || match[3];
    if (!name) continue;
    if (match[3]) {
      // bare identifier — verify there's a declaration upstream so we don't
      // pick up a reserved word or accidental match.
      const before = content.slice(0, match.index);
      if (VAR_DECL_RE_TEMPLATE(name).test(before)) return name;
      // Not declared locally → still a real export name (could be re-exported)
      return name;
    }
    return name;
  }
  return null;
}
