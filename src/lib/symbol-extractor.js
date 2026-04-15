/**
 * Symbol Extractor — regex-based extraction of definitions and references.
 *
 * Extracts top-level function/type/class definitions from source files,
 * enabling intra-package edge detection for languages where files in the
 * same directory can reference each other without explicit imports
 * (Go, Java, Kotlin, C#, Swift, Scala).
 *
 * No tree-sitter — pure regex, zero dependencies.
 */

// Languages where files in the same directory can reference each other
// without explicit imports (same package / same module / same namespace).
export const INTRA_DIR_EXTS = new Set([
  '.go',
  '.java', '.kt', '.kts',
  '.cs',
  '.swift',
  '.scala',
]);

// Common Go builtins / keywords to skip during reference scanning
const GO_BUILTINS = new Set([
  'error', 'string', 'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128',
  'bool', 'byte', 'rune', 'any',
  'nil', 'true', 'false', 'iota',
  'len', 'cap', 'make', 'new', 'append', 'copy', 'delete',
  'close', 'panic', 'recover', 'print', 'println',
  'func', 'type', 'struct', 'interface', 'map', 'chan',
  'const', 'var', 'import', 'package', 'return', 'range',
  'for', 'if', 'else', 'switch', 'case', 'default', 'select',
  'defer', 'go', 'break', 'continue', 'fallthrough', 'goto',
]);

const JAVA_BUILTINS = new Set([
  'String', 'Object', 'Integer', 'Long', 'Double', 'Float', 'Boolean',
  'List', 'Map', 'Set', 'Collection', 'ArrayList', 'HashMap', 'HashSet',
  'Exception', 'RuntimeException', 'Throwable', 'Error',
  'Override', 'Deprecated', 'SuppressWarnings',
  'System', 'Math', 'Arrays', 'Collections',
  'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short',
  'class', 'interface', 'enum', 'extends', 'implements', 'abstract',
  'public', 'private', 'protected', 'static', 'final', 'synchronized',
  'return', 'new', 'this', 'super', 'null', 'true', 'false',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package',
]);

const CS_BUILTINS = new Set([
  'string', 'int', 'long', 'double', 'float', 'bool', 'char', 'byte',
  'decimal', 'object', 'void', 'var', 'dynamic',
  'String', 'Object', 'Int32', 'Int64', 'Double', 'Boolean',
  'List', 'Dictionary', 'HashSet', 'IEnumerable', 'Task',
  'Exception', 'ArgumentException', 'InvalidOperationException',
  'Console', 'Math', 'Convert',
  'class', 'struct', 'interface', 'enum', 'delegate', 'record',
  'public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed',
  'return', 'new', 'this', 'base', 'null', 'true', 'false',
  'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'default',
  'try', 'catch', 'finally', 'throw', 'using', 'namespace', 'async', 'await',
]);

// ---------------------------------------------------------------------------
// Comment/string stripping
// ---------------------------------------------------------------------------

/**
 * Strip comments and string literals from C-family source code.
 * Returns content suitable for symbol reference scanning.
 */
function stripCFamily(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
    .replace(/\/\/.*$/gm, '')                // line comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')     // double-quoted strings
    .replace(/`[^`]*`/g, '``')              // backtick strings (Go raw strings)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");   // single-quoted chars
}

/**
 * Strip comments and strings from source code, dispatched by language.
 */
export function stripForScanning(content, ext) {
  if (['.go', '.java', '.kt', '.kts', '.cs', '.swift', '.scala',
       '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
       '.rs', '.dart', '.php'].includes(ext)) {
    return stripCFamily(content);
  }
  if (ext === '.py') {
    return content
      .replace(/('{3}|"{3})[\s\S]*?\1/g, '')
      .replace(/#.*$/gm, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  }
  if (ext === '.rb') {
    return content
      .replace(/^=begin[\s\S]*?^=end/gm, '')
      .replace(/#.*$/gm, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  }
  return content;
}

// ---------------------------------------------------------------------------
// Per-language definition extractors
// ---------------------------------------------------------------------------

function extractGoDefinitions(content) {
  const defs = [];
  let match;

  // func Name(
  const funcRe = /^func\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((match = funcRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // func (r *Type) Name(
  const methodRe = /^func\s+\([^)]+\)\s*([A-Za-z_]\w*)\s*\(/gm;
  while ((match = methodRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'method' });
  }

  // type Name struct/interface/...
  const typeRe = /^type\s+([A-Za-z_]\w*)\s+/gm;
  while ((match = typeRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'type' });
  }

  // Single-line const/var
  const varRe = /^(?:var|const)\s+([A-Za-z_]\w*)\s/gm;
  while ((match = varRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'var' });
  }

  // Block const/var/type: extract names from indented lines inside ( )
  const blockRe = /^(?:var|const|type)\s*\(([\s\S]*?)\n\)/gm;
  while ((match = blockRe.exec(content)) !== null) {
    const block = match[1];
    const nameRe = /^\s+([A-Za-z_]\w*)\s/gm;
    let nameMatch;
    while ((nameMatch = nameRe.exec(block)) !== null) {
      defs.push({ name: nameMatch[1], type: 'var' });
    }
  }

  return defs;
}

function extractJavaDefinitions(content) {
  const defs = [];
  let match;

  // class/interface/enum/record Name
  const classRe = /\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  // Method definitions: access? static? returnType name(
  // Simplified: look for word followed by word followed by (
  const methodRe = /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:synchronized\s+)?(?:[\w<>\[\],?\s]+)\s+([a-z_]\w*)\s*\(/gm;
  while ((match = methodRe.exec(content)) !== null) {
    const name = match[1];
    // Skip common false positives
    if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'else'].includes(name)) {
      defs.push({ name, type: 'method' });
    }
  }

  return defs;
}

function extractCsDefinitions(content) {
  const defs = [];
  let match;

  // class/interface/struct/enum/record Name
  const classRe = /\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  // Method definitions (similar to Java)
  const methodRe = /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?(?:abstract\s+)?(?:[\w<>\[\],?\s]+)\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((match = methodRe.exec(content)) !== null) {
    const name = match[1];
    if (!['if', 'for', 'foreach', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'else', 'using', 'lock'].includes(name)) {
      defs.push({ name, type: 'method' });
    }
  }

  return defs;
}

function extractSwiftDefinitions(content) {
  const defs = [];
  let match;

  // func name(
  const funcRe = /\bfunc\s+([A-Za-z_]\w*)\s*[(<]/g;
  while ((match = funcRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // class/struct/enum/protocol/actor Name
  const classRe = /\b(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  return defs;
}

function extractScalaDefinitions(content) {
  const defs = [];
  let match;

  // def name
  const defRe = /\bdef\s+([A-Za-z_]\w*)/g;
  while ((match = defRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // class/object/trait/case class Name
  const classRe = /\b(?:class|object|trait)\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  return defs;
}

function extractPyDefinitions(content) {
  const defs = [];
  let match;

  // def name(
  const funcRe = /^def\s+([A-Za-z_]\w*)\s*\(/gm;
  while ((match = funcRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // class Name
  const classRe = /^class\s+([A-Za-z_]\w*)/gm;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  return defs;
}

function extractRsDefinitions(content) {
  const defs = [];
  let match;

  // fn name(
  const funcRe = /\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*[(<]/g;
  while ((match = funcRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // struct/enum/trait Name
  const typeRe = /\b(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g;
  while ((match = typeRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'type' });
  }

  return defs;
}

function extractRbDefinitions(content) {
  const defs = [];
  let match;

  // def name
  const defRe = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/gm;
  while ((match = defRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'method' });
  }

  // class Name / module Name
  const classRe = /^\s*(?:class|module)\s+([A-Z]\w*)/gm;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  return defs;
}

function extractPhpDefinitions(content) {
  const defs = [];
  let match;

  // function name(
  const funcRe = /\bfunction\s+([A-Za-z_]\w*)\s*\(/g;
  while ((match = funcRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'function' });
  }

  // class/interface/trait Name
  const classRe = /\b(?:class|interface|trait)\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  return defs;
}

function extractDartDefinitions(content) {
  const defs = [];
  let match;

  // class Name
  const classRe = /\bclass\s+([A-Za-z_]\w*)/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  // Top-level function definitions
  const funcRe = /^(?:[\w<>?]+\s+)?([A-Za-z_]\w*)\s*[(<]/gm;
  while ((match = funcRe.exec(content)) !== null) {
    const name = match[1];
    if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'class', 'import', 'export'].includes(name)) {
      defs.push({ name, type: 'function' });
    }
  }

  return defs;
}

function extractCppDefinitions(content) {
  const defs = [];
  let match;

  // class/struct Name
  const classRe = /\b(?:class|struct)\s+([A-Za-z_]\w*)\s*[:{]/g;
  while ((match = classRe.exec(content)) !== null) {
    defs.push({ name: match[1], type: 'class' });
  }

  // Function definitions: returnType name(  (simplified — won't catch everything)
  const funcRe = /^(?:[\w*&:<>]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?[{]/gm;
  while ((match = funcRe.exec(content)) !== null) {
    const name = match[1];
    if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'delete', 'sizeof'].includes(name)) {
      defs.push({ name, type: 'function' });
    }
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Main extraction dispatcher
// ---------------------------------------------------------------------------

/**
 * Extract symbol definitions from a source file.
 * @param {string} content - Source code (already stripped of comments/strings)
 * @param {string} ext - File extension (e.g. '.go')
 * @returns {Array<{ name: string, type: string }>}
 */
export function extractDefinitions(content, ext) {
  switch (ext) {
    case '.go': return extractGoDefinitions(content);
    case '.py': return extractPyDefinitions(content);
    case '.java': case '.kt': case '.kts': return extractJavaDefinitions(content);
    case '.rs': return extractRsDefinitions(content);
    case '.rb': return extractRbDefinitions(content);
    case '.php': return extractPhpDefinitions(content);
    case '.swift': return extractSwiftDefinitions(content);
    case '.dart': return extractDartDefinitions(content);
    case '.cs': return extractCsDefinitions(content);
    case '.scala': return extractScalaDefinitions(content);
    case '.c': case '.cpp': case '.cc': case '.cxx':
    case '.h': case '.hpp': case '.hxx':
      return extractCppDefinitions(content);
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Builtin filter — get the right builtin set for a language
// ---------------------------------------------------------------------------

function getBuiltins(ext) {
  if (ext === '.go') return GO_BUILTINS;
  if (['.java', '.kt', '.kts', '.scala'].includes(ext)) return JAVA_BUILTINS;
  if (ext === '.cs') return CS_BUILTINS;
  return new Set();
}

// ---------------------------------------------------------------------------
// Intra-directory symbol edge building
// ---------------------------------------------------------------------------

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build symbol-level edges between files in the same directory.
 *
 * For languages like Go where files in the same directory form a package
 * and can reference each other's symbols without imports.
 *
 * @param {Object} files - Map of relPath → { definitions, strippedContent, ext }
 * @returns {Array<{ from: string, to: string }>}
 */
export function buildIntraDirectoryEdges(files) {
  // Group files by directory
  const dirGroups = {};
  for (const [relPath, info] of Object.entries(files)) {
    if (!info.definitions || info.definitions.length === 0) continue;
    if (!INTRA_DIR_EXTS.has(info.ext)) continue;

    const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '.';
    if (!dirGroups[dir]) dirGroups[dir] = [];
    dirGroups[dir].push({ relPath, ...info });
  }

  const edges = [];

  for (const fileEntries of Object.values(dirGroups)) {
    // Need at least 2 files in the directory for intra-dir edges
    if (fileEntries.length < 2) continue;

    // Determine language from first file
    const ext = fileEntries[0].ext;
    const builtins = getBuiltins(ext);

    // Build definition map: symbolName → filePaths that define it
    const defMap = {};
    for (const entry of fileEntries) {
      for (const def of entry.definitions) {
        // Skip builtins and very short names
        if (builtins.has(def.name) || def.name.length < 2) continue;
        if (!defMap[def.name]) defMap[def.name] = [];
        defMap[def.name].push(entry.relPath);
      }
    }

    // For each file, check which symbols from OTHER files are referenced
    for (const entry of fileEntries) {
      const ownDefs = new Set(entry.definitions.map(d => d.name));
      const content = entry.strippedContent || '';
      const addedEdges = new Set(); // deduplicate edges per file pair

      for (const [symbolName, defFiles] of Object.entries(defMap)) {
        // Skip if this file defines the symbol itself
        if (ownDefs.has(symbolName)) continue;

        // Check if the symbol appears in this file
        const re = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
        if (re.test(content)) {
          for (const defFile of defFiles) {
            if (defFile !== entry.relPath && !addedEdges.has(defFile)) {
              edges.push({ from: entry.relPath, to: defFile });
              addedEdges.add(defFile);
            }
          }
        }
      }
    }
  }

  return edges;
}
