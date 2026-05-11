import { join, basename, dirname } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';

/**
 * Discover all skill files in a skills directory.
 * @param {string} skillsDir — path to skills directory
 * @param {object} [options]
 * @param {string} [options.skillFilename='skill.md'] — skill filename to match (e.g., 'skill.md' or 'SKILL.md')
 * @returns {Array<{ name, path, content, frontmatter, activationPatterns }>}
 */
export function findSkillFiles(skillsDir, options = {}) {
  const skillFilename = options.skillFilename || 'skill.md';
  const skills = [];

  if (!existsSync(skillsDir)) return skills;

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkDir(full);
        } else if (entry === skillFilename) {
          const content = readFileSync(full, 'utf8');
          const frontmatter = parseFrontmatter(content);
          const activationPatterns = parseActivationPatterns(content);
          const domain = basename(dirname(full));

          skills.push({
            name: frontmatter?.name || domain || entry,
            path: full,
            content,
            frontmatter: frontmatter || { name: null, description: null },
            activationPatterns,
          });
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkDir(skillsDir);
  return skills;
}

/**
 * Parse YAML frontmatter from skill content.
 * Returns { name, description } or null.
 * Uses regex -- no YAML library (matching existing codebase pattern).
 */
export function parseFrontmatter(content) {
  if (!content || typeof content !== 'string') return null;

  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const block = match[1];
  const nameMatch = block.match(/name:\s*(.+)/);
  const descMatch = block.match(/description:\s*(.+)/);

  if (!nameMatch && !descMatch) return null;

  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    description: descMatch ? descMatch[1].trim() : null,
  };
}

/**
 * Parse `triggers:` block from YAML frontmatter.
 * Supports:
 *   triggers:
 *     files:
 *       - app/deps.py
 *     keywords: [auth, jwt]        # inline array
 *     keywords:                    # block array
 *       - auth
 *     alwaysActivate: true
 *
 * Returns { filePatterns: string[], keywords: string[], alwaysActivate: boolean }
 * Returns null when no `triggers:` key is present in frontmatter.
 */
export function parseTriggersFrontmatter(content) {
  if (!content || typeof content !== 'string') return null;

  // Extract the frontmatter block (between first --- and second ---)
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;

  const block = fmMatch[1];

  // Check if triggers: key exists at all
  if (!/^triggers:/m.test(block)) return null;

  // Extract the triggers sub-block: from "triggers:" to the next top-level key or end
  // Top-level YAML keys start at column 0 with no leading spaces
  const triggersMatch = block.match(/^triggers:\s*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)*)/m);
  if (!triggersMatch) {
    // "triggers:" with no sub-block — treat as empty triggers present
    return { filePatterns: [], keywords: [], alwaysActivate: false };
  }

  const triggersBlock = triggersMatch[1];

  // --- parse files: sub-key ---
  const filePatterns = [];
  const filesSubMatch = triggersBlock.match(/[ \t]+files:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)*)/);
  if (filesSubMatch) {
    const listBlock = filesSubMatch[1];
    const itemRegex = /[ \t]+-\s*(.+)/g;
    let m;
    while ((m = itemRegex.exec(listBlock)) !== null) {
      const val = m[1].trim().replace(/^['"]|['"]$/g, '');
      if (val) filePatterns.push(val);
    }
  }

  // --- parse keywords: sub-key (inline array OR block list) ---
  const keywords = [];
  // Inline: keywords: [auth, jwt, token]
  const kwInlineMatch = triggersBlock.match(/[ \t]+keywords:\s*\[([^\]]*)\]/);
  if (kwInlineMatch) {
    kwInlineMatch[1]
      .split(',')
      .map(k => k.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .forEach(k => keywords.push(k));
  } else {
    // Block list: keywords:\n  - auth
    const kwBlockMatch = triggersBlock.match(/[ \t]+keywords:\s*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)*)/);
    if (kwBlockMatch) {
      const listBlock = kwBlockMatch[1];
      const itemRegex = /[ \t]+-\s*(.+)/g;
      let m;
      while ((m = itemRegex.exec(listBlock)) !== null) {
        const val = m[1].trim().replace(/^['"]|['"]$/g, '');
        if (val) keywords.push(val);
      }
    }
  }

  // --- parse alwaysActivate: ---
  let alwaysActivate = false;
  const aaMatch = triggersBlock.match(/[ \t]+alwaysActivate:\s*(true|false)/i);
  if (aaMatch) {
    alwaysActivate = aaMatch[1].toLowerCase() === 'true';
  }

  return { filePatterns, keywords, alwaysActivate };
}

/**
 * Extract file patterns from a skill file.
 * Prefers `triggers.files` from YAML frontmatter when present;
 * falls back to parsing `## Activation` section for backwards compatibility.
 * Returns string[] of glob patterns.
 */
export function parseActivationPatterns(content) {
  if (!content || typeof content !== 'string') return [];

  // Prefer frontmatter triggers
  const fromFrontmatter = parseTriggersFrontmatter(content);
  if (fromFrontmatter !== null) {
    return fromFrontmatter.filePatterns;
  }

  // Fallback: parse ## Activation section (legacy)
  const activationMatch = content.match(/## Activation[\s\S]*?(?=\n---|\n## (?!Activation)|$)/);
  if (!activationMatch) return [];

  const block = activationMatch[0];
  const patterns = [];

  // Match lines like: - `src/commands/doc-init.js`
  const lineRegex = /^[\s]*-\s*`([^`]+)`/gm;
  let m;
  while ((m = lineRegex.exec(block)) !== null) {
    const pattern = m[1].trim();
    if (pattern) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

// Path segments too generic to use for skill matching
export const GENERIC_PATH_SEGMENTS = new Set([
  'src', 'app', 'lib', 'api', 'v1', 'v2', 'components', 'services',
  'utils', 'helpers', 'common', 'core', 'config', 'middleware',
  'models', 'types', 'hooks', 'pages', 'routes', 'tests', 'test',
  'public', 'assets', 'styles', 'scripts',
]);

/**
 * Extract the ## Activation section from skill content, lowercased.
 * Uses the robust lookahead regex that stops at --- or another ## heading.
 */
export function getActivationBlock(content) {
  if (!content || typeof content !== 'string') return '';
  const match = content.match(/## Activation[\s\S]*?(?=\n---|\n## (?!Activation)|$)/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Check if a file path matches an activation block.
 * Tests filename and meaningful path segments (skipping generic ones).
 */
export function fileMatchesActivation(filePath, activationBlock, genericSegments = GENERIC_PATH_SEGMENTS) {
  if (!filePath || !activationBlock) return false;
  const lower = filePath.toLowerCase();
  const parts = lower.split('/').filter(Boolean);
  const name = parts.pop();
  if (name && activationBlock.includes(name)) return true;
  const segs = parts.filter(seg => !genericSegments.has(seg) && seg.length > 2);
  return segs.some(seg => activationBlock.includes(seg));
}

/**
 * Extract keywords from a skill file.
 * Prefers `triggers.keywords` from YAML frontmatter when present;
 * falls back to parsing `Keywords:` line in the `## Activation` section.
 * Returns string[] or empty array.
 */
export function parseKeywords(content) {
  if (!content || typeof content !== 'string') return [];

  // Prefer frontmatter triggers
  const fromFrontmatter = parseTriggersFrontmatter(content);
  if (fromFrontmatter !== null) {
    return fromFrontmatter.keywords;
  }

  // Fallback: look for "Keywords:" line within ## Activation or as standalone
  const keywordsMatch = content.match(/Keywords:\s*(.+)/i);
  if (!keywordsMatch) return [];

  return keywordsMatch[1]
    .split(',')
    .map(k => k.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}
