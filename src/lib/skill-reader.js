import { join, basename, dirname } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';

/**
 * Discover all skill files in a .claude/skills/ directory.
 * Returns [{ name, path, content, frontmatter: { name, description }, activationPatterns: string[] }]
 */
export function findSkillFiles(skillsDir) {
  const skills = [];

  if (!existsSync(skillsDir)) return skills;

  function walkDir(dir) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkDir(full);
        } else if (entry === 'skill.md' || entry.endsWith('.md')) {
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
