/**
 * Content transform system for multi-target output.
 *
 * Transforms canonical skill output (generated for Claude target) into
 * other target formats. The key insight: Claude Code uses centralized
 * skills in .claude/skills/, while Codex CLI uses directory-scoped
 * AGENTS.md files placed in actual source directories.
 */

import { join, dirname, basename, relative } from 'path';
import { existsSync } from 'fs';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Transform a set of generated files for a specific target.
 *
 * @param {Array<{path: string, content: string}>} files — from parseFileOutput (Claude paths)
 * @param {object} sourceTarget — target files were generated for
 * @param {object} destTarget — target to transform to
 * @param {object} context — { scanResult, graphSerialized? }
 * @returns {Array<{path: string, content: string}>}
 */
export function transformForTarget(files, sourceTarget, destTarget, context) {
  if (sourceTarget.id === destTarget.id) return files;

  if (destTarget.placement === 'centralized') {
    return transformToCentralized(files, sourceTarget, destTarget);
  }

  if (destTarget.placement === 'directory-scoped') {
    return transformToDirectoryScoped(files, sourceTarget, destTarget, context);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Centralized transform (future: Cursor, etc.)
// ---------------------------------------------------------------------------

function transformToCentralized(files, sourceTarget, destTarget) {
  return files.map(f => ({
    path: remapCentralizedPath(f.path, sourceTarget, destTarget),
    content: remapContentPaths(f.content, sourceTarget, destTarget),
  }));
}

function remapCentralizedPath(filePath, sourceTarget, destTarget) {
  // CLAUDE.md → AGENTS.md (or vice versa)
  if (filePath === sourceTarget.instructionsFile) {
    return destTarget.instructionsFile;
  }
  // .claude/skills/foo/skill.md → .dest/skills/foo/skill.md
  if (filePath.startsWith(sourceTarget.skillsDir + '/')) {
    const rest = filePath.slice(sourceTarget.skillsDir.length + 1);
    return `${destTarget.skillsDir}/${rest}`;
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Directory-scoped transform (Codex CLI)
// ---------------------------------------------------------------------------

function transformToDirectoryScoped(files, sourceTarget, destTarget, context) {
  const { scanResult, graphSerialized } = context;
  const result = [];

  // Separate files by type
  const baseSkillPrefix = sourceTarget.skillsDir + '/base/';
  const baseSkill = files.find(f => f.path.startsWith(baseSkillPrefix));
  const instructionsFile = files.find(f => f.path === sourceTarget.instructionsFile);
  const domainSkills = files.filter(f =>
    f !== baseSkill && f !== instructionsFile && f.path.startsWith(sourceTarget.skillsDir + '/')
  );

  // 1. Build root AGENTS.md from base skill + instructions + code-map
  const rootContent = buildRootInstructions(baseSkill, instructionsFile, graphSerialized, destTarget);
  if (rootContent) {
    result.push({ path: destTarget.instructionsFile, content: rootContent });
  }

  // 2. Map domain skills → source directory AGENTS.md files
  for (const skill of domainSkills) {
    const domainName = extractDomainName(skill.path, sourceTarget);
    const targetDir = resolveDomainDirectory(domainName, scanResult);

    if (!targetDir) continue; // skip if we can't determine placement

    const content = transformDomainSkill(skill.content, sourceTarget, destTarget);
    result.push({
      path: join(targetDir, destTarget.directoryDocFile || 'AGENTS.md'),
      content,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Root instructions builder
// ---------------------------------------------------------------------------

function buildRootInstructions(baseSkill, instructionsFile, graphSerialized, destTarget) {
  const sections = [];

  // Start with instructions file content (CLAUDE.md equivalent)
  if (instructionsFile) {
    let content = instructionsFile.content;
    content = stripActivationSection(content);
    content = content.replace(/CLAUDE\.md/g, destTarget.instructionsFile);
    content = content.replace(/\.claude\/skills\//g, '');
    sections.push(content.trim());
  } else if (baseSkill) {
    // Fall back to base skill if no instructions file
    let content = baseSkill.content;
    content = stripActivationSection(content);
    content = content.replace(/CLAUDE\.md/g, destTarget.instructionsFile);
    content = content.replace(/\.claude\/skills\//g, '');
    sections.push(content.trim());
  }

  // Embed condensed code-map if target needs it and graph data is available
  if (destTarget.needsCodeMapEmbed && graphSerialized) {
    const codeMap = generateCondensedCodeMap(graphSerialized);
    if (codeMap) {
      sections.push(codeMap);
    }
  }

  if (sections.length === 0) return null;

  let result = sections.join('\n\n') + '\n';

  // Warn if root instructions exceed target's max budget
  const maxBytes = destTarget.maxInstructionsBytes;
  if (maxBytes && Buffer.byteLength(result, 'utf8') > maxBytes) {
    const sizeKB = Math.round(Buffer.byteLength(result, 'utf8') / 1024);
    const limitKB = Math.round(maxBytes / 1024);
    console.warn(
      `Warning: Root ${destTarget.instructionsFile} is ${sizeKB} KiB, ` +
      `exceeding ${destTarget.label}'s ${limitKB} KiB default budget. ` +
      `Consider trimming or increasing project_doc_max_bytes in config.`
    );
  }

  return result;
}

/**
 * Generate a condensed code-map suitable for embedding in root AGENTS.md.
 * Targets ~2-4 KiB to stay within budget.
 */
function generateCondensedCodeMap(serializedGraph) {
  const lines = [];

  // Hub files (top 5 only for condensed version)
  if (serializedGraph.hubs?.length > 0) {
    lines.push('## Key Files');
    lines.push('');
    lines.push('**Hub files (most depended-on):**');
    for (const h of serializedGraph.hubs.slice(0, 5)) {
      lines.push(`- \`${h.path}\` — ${h.fanIn} dependents`);
    }
    lines.push('');
  }

  // Domain clusters (condensed table)
  if (serializedGraph.clusters?.length > 0) {
    const multiFileClusters = serializedGraph.clusters.filter(c => c.size > 1);
    if (multiFileClusters.length > 0) {
      lines.push('**Domain clusters:**');
      lines.push('');
      lines.push('| Domain | Files | Top entries |');
      lines.push('|--------|-------|-------------|');
      for (const c of multiFileClusters.slice(0, 10)) {
        const topFiles = c.files
          .filter(f => serializedGraph.files[f])
          .sort((a, b) => (serializedGraph.files[b]?.priority || 0) - (serializedGraph.files[a]?.priority || 0))
          .slice(0, 3)
          .map(f => `\`${shortPath(f)}\``)
          .join(', ');
        lines.push(`| ${c.label} | ${c.size} | ${topFiles} |`);
      }
      lines.push('');
    }
  }

  // Hotspots (top 3 for condensed)
  if (serializedGraph.hotspots?.length > 0) {
    lines.push('**High-churn hotspots:**');
    for (const h of serializedGraph.hotspots.slice(0, 3)) {
      lines.push(`- \`${h.path}\` — ${h.churn} changes`);
    }
    lines.push('');
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function shortPath(filePath) {
  const parts = filePath.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : filePath;
}

// ---------------------------------------------------------------------------
// Domain skill transform
// ---------------------------------------------------------------------------

function transformDomainSkill(content, sourceTarget, destTarget) {
  let result = content;

  // Strip ## Activation section (location IS activation for Codex)
  result = stripActivationSection(result);

  // Rewrite internal path references
  result = remapContentPaths(result, sourceTarget, destTarget);

  return result;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Strip the ## Activation section from skill content.
 */
function stripActivationSection(content) {
  // Match ## Activation and everything up to the next ## heading or ---
  return content.replace(
    /## Activation\s*\r?\n[\s\S]*?(?=\r?\n## |\r?\n---|\r?\n\*\*Last Updated|$)/,
    ''
  ).replace(/(\r?\n){3,}/g, '\n\n');
}

/**
 * Rewrite path references in content from source to dest target.
 */
function remapContentPaths(content, sourceTarget, destTarget) {
  let result = content;

  // Instructions file
  if (sourceTarget.instructionsFile !== destTarget.instructionsFile) {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.instructionsFile), 'g'),
      destTarget.instructionsFile
    );
  }

  // Skills dir paths — replace .claude/skills/domain/skill.md references
  if (sourceTarget.skillsDir && destTarget.placement === 'directory-scoped') {
    // For directory-scoped targets, remove the skills dir prefix
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.skillsDir) + '/[\\w-]+/' + escapeRegex(sourceTarget.skillFilename), 'g'),
      (match) => {
        const parts = match.split('/');
        const domain = parts[parts.length - 2];
        return `${domain}/`;
      }
    );
  } else if (sourceTarget.skillsDir && destTarget.skillsDir) {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.skillsDir), 'g'),
      destTarget.skillsDir
    );
  }

  // Config dir
  if (sourceTarget.configDir && destTarget.configDir) {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.configDir + '/'), 'g'),
      destTarget.configDir + '/'
    );
  }

  return result;
}

/**
 * Extract domain name from a skill file path.
 * e.g., '.claude/skills/billing/skill.md' → 'billing'
 */
function extractDomainName(skillPath, target) {
  const prefix = target.skillsDir + '/';
  if (!skillPath.startsWith(prefix)) return null;
  const rest = skillPath.slice(prefix.length);
  return rest.split('/')[0];
}

/**
 * Resolve a domain name to its primary source directory.
 * Uses scanner's domain.directories[0] with fallback to activation patterns.
 */
function resolveDomainDirectory(domainName, scanResult) {
  if (!scanResult?.domains) return null;

  const domain = scanResult.domains.find(d =>
    d.name === domainName || d.name.toLowerCase() === domainName.toLowerCase()
  );

  if (domain?.directories?.length) {
    return domain.directories[0];
  }

  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Directory-scoped output validation
// ---------------------------------------------------------------------------

/**
 * Validate that transformed files are safe to write.
 * For directory-scoped output, files go into source dirs (not .claude/).
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateTransformedFiles(files) {
  const issues = [];

  for (const { path: filePath } of files) {
    // Block absolute paths
    if (filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
      issues.push(`Absolute path not allowed: ${filePath}`);
      continue;
    }
    // Block traversal
    if (filePath.includes('..')) {
      issues.push(`Path traversal not allowed: ${filePath}`);
      continue;
    }
    // For directory-scoped, must end with a known doc file
    if (!filePath.endsWith('AGENTS.md') && !filePath.endsWith('SKILL.md') && !filePath.endsWith('CLAUDE.md')) {
      issues.push(`Unexpected filename: ${filePath}`);
    }
  }

  return { valid: issues.length === 0, issues };
}
