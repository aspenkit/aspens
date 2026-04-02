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
        } else if (entry === skillFilename || (entry.endsWith('.md') && entry !== 'README.md' && entry !== 'CHANGELOG.md')) {
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
 * Extract file patterns from ## Activation section.
 * Returns string[] of patterns like ["src/lib/*.js", "src/prompts/**\/*"]
 * Parses lines starting with `- \`` wrapped in backticks.
 */
export function parseActivationPatterns(content) {
  if (!content || typeof content !== 'string') return [];

  // Match the Activation section: from "## Activation" to the next "---" or "##"
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
 * Extract keywords from ## Activation Keywords: line.
 * Returns string[] or empty array.
 */
export function parseKeywords(content) {
  if (!content || typeof content !== 'string') return [];

  // Look for "Keywords:" line within the Activation section or as a standalone line
  const keywordsMatch = content.match(/Keywords:\s*(.+)/i);
  if (!keywordsMatch) return [];

  return keywordsMatch[1]
    .split(',')
    .map(k => k.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}
