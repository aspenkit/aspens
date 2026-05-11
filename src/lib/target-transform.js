/**
 * Content transform system for multi-target output.
 *
 * Canonical generation produces Claude-shaped docs first.
 * Other targets are projected from that canonical output.
 */

import { join } from 'path';
import { readFileSync } from 'fs';
import { TARGETS } from './target.js';
import { CliError } from './errors.js';

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

function transformToCentralized(files, sourceTarget, destTarget) {
  return files.map(file => ({
    path: remapCentralizedPath(file.path, sourceTarget, destTarget),
    content: remapContentPaths(file.content, sourceTarget, destTarget),
  }));
}

function remapCentralizedPath(filePath, sourceTarget, destTarget) {
  if (filePath === sourceTarget.instructionsFile) {
    return destTarget.instructionsFile;
  }

  if (filePath.startsWith(sourceTarget.skillsDir + '/')) {
    const rest = filePath.slice(sourceTarget.skillsDir.length + 1);
    return destTarget.skillsDir + '/' + rest;
  }

  return filePath;
}

function transformToDirectoryScoped(files, sourceTarget, destTarget, context) {
  const scanResult = context?.scanResult;
  const graphSerialized = context?.graphSerialized;
  const repoPath = context?.repoPath;
  const result = [];

  const baseSkillPrefix = sourceTarget.skillsDir + '/base/';
  const baseSkill = files.find(file => file.path.startsWith(baseSkillPrefix));
  let instructionsFile = files.find(file => file.path === sourceTarget.instructionsFile);

  if (!instructionsFile && repoPath && sourceTarget.instructionsFile) {
    try {
      const content = readFileSync(join(repoPath, sourceTarget.instructionsFile), 'utf8');
      instructionsFile = { path: sourceTarget.instructionsFile, content };
    } catch {}
  }
  const domainSkills = files.filter(file =>
    file !== baseSkill &&
    file !== instructionsFile &&
    file.path.startsWith(sourceTarget.skillsDir + '/')
  );

  const rootContent = buildRootInstructions(baseSkill, instructionsFile, domainSkills, graphSerialized, destTarget);
  if (rootContent) {
    result.push({ path: destTarget.instructionsFile, content: rootContent });
  }

  if (baseSkill) {
    result.push({
      path: join(destTarget.skillsDir, 'base', destTarget.skillFilename),
      content: remapContentPaths(baseSkill.content, sourceTarget, destTarget),
    });
  }

  for (const skill of domainSkills) {
    const domainName = extractDomainName(skill.path, sourceTarget);
    if (!domainName) continue;

    result.push({
      path: join(destTarget.skillsDir, domainName, destTarget.skillFilename),
      content: remapContentPaths(skill.content, sourceTarget, destTarget),
    });

    const targetDir = resolveDomainDirectory(domainName, scanResult);
    if (!targetDir) continue;

    result.push({
      path: join(targetDir, destTarget.directoryDocFile || 'AGENTS.md'),
      content: transformDomainSkill(skill.content, sourceTarget, destTarget),
    });
  }

  if (destTarget.skillsDir && graphSerialized) {
    result.push(...generateCodexSkillReferences(destTarget, graphSerialized));
  }

  return result;
}

function generateCodexSkillReferences(destTarget, graphSerialized) {
  const files = [];
  const skillsDir = destTarget.skillsDir;
  const archSkillPath = join(skillsDir, 'architecture', 'SKILL.md');
  const archRefPath = join(skillsDir, 'architecture', 'references', 'code-map.md');

  files.push({
    path: archSkillPath,
    content: [
      '---',
      'name: architecture',
      'description: >',
      '  Use when modifying imports, creating new files, refactoring modules,',
      '  or understanding how components relate. Not needed for simple single-file edits.',
      '---',
      '',
      '# Architecture',
      '',
      'This skill provides codebase structure and import graph data.',
      '',
      'When you need to understand file relationships, hub files, or domain clusters,',
      'check `references/code-map.md` for the full import graph analysis.',
      '',
      '## Key Rules',
      '',
      '- Check hub files (high fan-in) before modifying - changes propagate widely',
      '- Respect domain cluster boundaries - keep related files together',
      '- Check cross-domain dependencies before creating new imports',
      '',
    ].join('\n') + '\n',
  });

  const codeMap = generateCondensedCodeMap(graphSerialized);
  if (codeMap) {
    files.push({
      path: archRefPath,
      content: '# Code Map\n\n' + codeMap + '\n',
    });
  }

  return files;
}

function buildRootInstructions(baseSkill, instructionsFile, domainSkills, graphSerialized, destTarget) {
  const sections = [];

  if (instructionsFile) {
    let content = instructionsFile.content;
    content = stripActivationSection(content);
    content = remapContentPaths(content, { instructionsFile: 'CLAUDE.md', skillsDir: '.claude/skills', skillFilename: 'skill.md', configDir: '.claude' }, destTarget);
    if (destTarget.id === 'codex') {
      content = sanitizeCodexInstructions(content);
      content = syncSkillsSection(content, baseSkill, domainSkills, destTarget, !!graphSerialized);
    }
    sections.push(content.trim());
  } else if (baseSkill) {
    let content = baseSkill.content;
    content = stripActivationSection(content);
    content = remapContentPaths(content, { instructionsFile: 'CLAUDE.md', skillsDir: '.claude/skills', skillFilename: 'skill.md', configDir: '.claude' }, destTarget);
    if (destTarget.id === 'codex') {
      content = sanitizeCodexInstructions(content);
      content = syncSkillsSection(content, baseSkill, domainSkills, destTarget, !!graphSerialized);
    }
    sections.push(content.trim());
  }

  if (destTarget.needsCodeMapEmbed && graphSerialized) {
    const codeMap = generateCondensedCodeMap(graphSerialized);
    if (codeMap) sections.push(codeMap);
  }

  if (sections.length === 0) return null;

  const result = sections.join('\n\n') + '\n';
  const maxBytes = destTarget.maxInstructionsBytes;
  if (maxBytes && Buffer.byteLength(result, 'utf8') > maxBytes) {
    const sizeKB = Math.round(Buffer.byteLength(result, 'utf8') / 1024);
    const limitKB = Math.round(maxBytes / 1024);
    console.warn(
      'Warning: Root ' + destTarget.instructionsFile + ' is ' + sizeKB + ' KiB, ' +
      'exceeding ' + destTarget.label + '\'s ' + limitKB + ' KiB default budget. ' +
      'Consider trimming or increasing project_doc_max_bytes in config.'
    );
  }

  return result;
}

/**
 * Stripped in Phase 1: stability. Previously injected a `## Key Files` hub-count
 * block into CLAUDE.md/AGENTS.md after LLM generation. That post-processing is
 * now removed — hub-counts/rankings live only in code-map and graph metadata.
 *
 * Function kept for API stability (callers were updated in the same commit) but
 * is now an identity transform that also removes legacy hub blocks if present.
 *
 * @param {string} content
 * @returns {string}
 */
export function ensureRootKeyFilesSection(content /*, graphSerialized */) {
  if (!content) return content;
  // Strip any legacy `## Key Files` block left over from older versions.
  const legacyHubBlockRegex = /\n## Key Files\s*\n[\s\S]*?(?=\n## |\n\*\*Last Updated|$)/;
  return content.replace(legacyHubBlockRegex, '\n').replace(/(\n){3,}/g, '\n\n');
}

const BEHAVIOR_RULES = [
  '- **Verify before claiming** — Never state that something is configured, running, scheduled, or complete without confirming it first. If you haven\'t verified it in this session, say so rather than assuming.',
  '- **Make sure code is running** — If you suggest code changes, ensure the code is running and tested before claiming the task is done.',
  '- **Ask clarifying questions** — If the task is ambiguous, ask for clarification rather than making assumptions. Don\'t imply or guess at requirements or constraints that aren\'t explicitly stated.',
  '- **Simplicity first** — Write the minimum code that solves the problem. No speculative features, abstractions for single-use code, or error handling for impossible scenarios.',
  '- **Surgical changes** — Touch only what the task requires. Don\'t refactor adjacent code, fix unrelated formatting, or "improve" things that aren\'t broken.',
];

/**
 * Deterministically inject/replace the `## Behavior` section in a root instructions
 * file so the same coding guardrails ship with every generated CLAUDE.md/AGENTS.md.
 */
export function syncBehaviorSection(content) {
  if (!content) return content;
  const section = ['## Behavior', '', ...BEHAVIOR_RULES].join('\n');
  if (/## Behavior\s*\n/i.test(content)) {
    return content.replace(/## Behavior\s*\n[\s\S]*?(?=\n## |\n\*\*Last Updated|$)/, section + '\n');
  }

  const lastUpdatedMatch = content.match(/\n\*\*Last Updated[^\n]*/);
  if (lastUpdatedMatch) {
    const idx = lastUpdatedMatch.index;
    return content.slice(0, idx).trimEnd() + '\n\n' + section + '\n' + content.slice(idx);
  }

  return content.trimEnd() + '\n\n' + section + '\n';
}

/**
 * Deterministically inject/replace the `## Skills` section in a root instructions
 * file (CLAUDE.md or AGENTS.md) so it always lists every generated skill.
 *
 * Caller is responsible for picking the right `destTarget` (paths + filename) and
 * whether to advertise the architecture skill ref (`hasArchitectureSkill`). The
 * architecture skill file is only written for Codex today, so Claude callers
 * should pass `false`.
 */
export function syncSkillsSection(content, baseSkill, domainSkills, destTarget, hasArchitectureSkill = false) {
  const skillRefs = buildSkillRefs(baseSkill, domainSkills, destTarget, hasArchitectureSkill);
  if (skillRefs.length === 0) return content;

  const section = ['## Skills', '', ...skillRefs].join('\n');
  if (/## Skills\s*\n/i.test(content)) {
    return content.replace(/## Skills\s*\n[\s\S]*?(?=\n## |\n\*\*Last Updated|$)/, section + '\n');
  }

  const headingMatch = content.match(/^# .+\n?/);
  if (!headingMatch) return section + '\n\n' + content;

  const insertAt = headingMatch[0].length;
  return content.slice(0, insertAt) + '\n' + section + '\n\n' + content.slice(insertAt).trimStart();
}

function buildSkillRefs(baseSkill, domainSkills, destTarget, hasArchitectureSkill = false) {
  const refs = [];

  if (baseSkill) {
    refs.push('- `' + join(destTarget.skillsDir, 'base', destTarget.skillFilename) + '` — Base repo skill; load whenever working in this repo.');
  }

  for (const skill of domainSkills) {
    const domainName = extractDomainFromAnyPath(skill.path);
    if (!domainName) continue;
    const description = extractFrontmatterField(skill.content, 'description');
    const suffix = description ? ' — ' + description : '';
    refs.push('- `' + join(destTarget.skillsDir, domainName, destTarget.skillFilename) + '`' + suffix);
  }

  if (hasArchitectureSkill) {
    refs.push('- `' + join(destTarget.skillsDir, 'architecture', destTarget.skillFilename) + '` — Import graph and code-map reference for structural changes.');
  }
  return refs;
}

function extractFrontmatterField(content, field) {
  const match = content.match(new RegExp('^' + escapeRegex(field) + ':\\s*(.+)$', 'm'));
  return match ? match[1].trim() : '';
}

function generateCondensedCodeMap(serializedGraph) {
  const lines = [];

  // Hub-files block intentionally removed — Phase 1: stability.
  // Hub counts/rankings no longer flow into AGENTS.md/CLAUDE.md;
  // they remain available via graph metadata + code-map.

  if (serializedGraph?.clusters?.length > 0) {
    const multiFileClusters = serializedGraph.clusters.filter(cluster => cluster.size > 1);
    if (multiFileClusters.length > 0) {
      lines.push('**Domain clusters:**');
      lines.push('');
      lines.push('| Domain | Files | Top entries |');
      lines.push('|--------|-------|-------------|');
      for (const cluster of multiFileClusters.slice(0, 10)) {
        const topFiles = cluster.files
          .filter(file => serializedGraph.files[file])
          .sort((a, b) => (serializedGraph.files[b]?.priority || 0) - (serializedGraph.files[a]?.priority || 0))
          .slice(0, 3)
          .map(shortPath)
          .map(file => '`' + file + '`')
          .join(', ');
        lines.push('| ' + cluster.label + ' | ' + cluster.size + ' | ' + topFiles + ' |');
      }
      lines.push('');
    }
  }

  if (serializedGraph?.hotspots?.length > 0) {
    lines.push('**High-churn hotspots:**');
    for (const hotspot of serializedGraph.hotspots.slice(0, 3)) {
      lines.push('- `' + hotspot.path + '` - ' + hotspot.churn + ' changes');
    }
    lines.push('');
  }

  // Phase 3 — Codex parity for framework entry points (Next.js implicit roots)
  const frameworkSection = condenseFrameworkEntryPoints(serializedGraph);
  if (frameworkSection) {
    lines.push(frameworkSection);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function condenseFrameworkEntryPoints(serializedGraph) {
  const entries = serializedGraph?.frameworkEntryPoints;
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const grouped = new Map();
  for (const entry of entries) {
    const list = grouped.get(entry.kind) || [];
    list.push(entry);
    grouped.set(entry.kind, list);
  }

  const out = [];
  for (const [kind, items] of grouped) {
    out.push('**Framework entry points (' + kind + '):**');
    for (const item of items.slice(0, 10)) {
      out.push('- `' + item.path + '`');
    }
    if (items.length > 10) {
      out.push('- ... +' + (items.length - 10) + ' more');
    }
    out.push('');
  }
  return out.join('\n');
}

function shortPath(filePath) {
  const parts = filePath.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : filePath;
}

function transformDomainSkill(content, sourceTarget, destTarget) {
  let result = stripActivationSection(content);
  result = remapContentPaths(result, sourceTarget, destTarget);
  if (destTarget.id === 'codex') {
    result = sanitizeCodexSkill(result);
  }
  return result;
}

export function projectCodexDomainDocs(files, target, scanResult) {
  if (!target?.skillsDir || !target?.directoryDocFile) return [];

  const projected = [];
  for (const file of files) {
    const domainName = extractDomainName(file.path, target);
    if (!domainName || domainName === 'base' || domainName === 'architecture') continue;

    const targetDir = resolveDomainDirectory(domainName, scanResult);
    if (!targetDir) continue;

    projected.push({
      path: join(targetDir, target.directoryDocFile),
      content: transformDomainSkill(file.content, target, target),
    });
  }

  return projected;
}

function stripActivationSection(content) {
  return content.replace(
    /## Activation\s*\r?\n[\s\S]*?(?=\r?\n## |\r?\n---|\r?\n\*\*Last Updated|$)/,
    ''
  ).replace(/(\r?\n){3,}/g, '\n\n');
}

function remapContentPaths(content, sourceTarget, destTarget) {
  let result = content;

  if (sourceTarget.instructionsFile !== destTarget.instructionsFile) {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.instructionsFile), 'g'),
      destTarget.instructionsFile
    );
  }

  if (sourceTarget.skillsDir && destTarget.placement === 'directory-scoped') {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.skillsDir) + '/[\\w-]+/' + escapeRegex(sourceTarget.skillFilename), 'g'),
      match => {
        const parts = match.split('/');
        const domain = parts[parts.length - 2];
        return destTarget.skillsDir + '/' + domain + '/' + destTarget.skillFilename;
      }
    );
    result = result.replace(/`([A-Za-z0-9_-]+)\/skill\.md`/g, (_match, domain) => {
      return '`' + destTarget.skillsDir + '/' + domain + '/' + destTarget.skillFilename + '`';
    });
    result = result.replace(/\b([A-Za-z0-9_-]+)\/skill\.md\b/g, (_match, domain) => {
      return destTarget.skillsDir + '/' + domain + '/' + destTarget.skillFilename;
    });
  } else if (sourceTarget.skillsDir && destTarget.skillsDir) {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.skillsDir), 'g'),
      destTarget.skillsDir
    );
  }

  if (sourceTarget.configDir && destTarget.configDir && destTarget.id !== 'codex') {
    result = result.replace(
      new RegExp(escapeRegex(sourceTarget.configDir + '/'), 'g'),
      destTarget.configDir + '/'
    );
  }

  return result;
}

function sanitizeCodexInstructions(content) {
  const filteredLines = content
    .split('\n')
    .filter(line =>
      !/aspens customize agents/i.test(line) &&
      !/claude code/i.test(line) &&
      !/generated Claude skills/i.test(line) &&
      !/\.claude\/hooks/i.test(line) &&
      !/\.codex\/hooks/i.test(line) &&
      !/skill-rules\.json/i.test(line) &&
      !/hook compatibility/i.test(line) &&
      !/CLAUDE\.md/i.test(line)
    );

  return filteredLines
    .join('\n')
    .replace(/Claude Code skills and CLAUDE\.md/g, 'project skills and instruction docs')
    .replace(/Claude Code skills and AGENTS\.md/g, 'project skills and AGENTS.md')
    .replace(/into their \.claude\/ directories/g, 'into target-specific directories')
    .replace(/into their \.codex\/ directories/g, 'into target-specific directories')
    .replace(/CLAUDE\.md/g, 'AGENTS.md')
    .replace(/plus `AGENTS\.md`/g, '')
    .replace(/Claude Code skills plus /g, '')
    .replace(/`base\/skill\.md`/g, '`.agents/skills/base/SKILL.md`')
    .replace(/\bbase\/skill\.md\b/g, '.agents/skills/base/SKILL.md')
    .replace(/(^|[^./A-Za-z0-9_-])`([a-z0-9_-]+)\/skill\.md`/gim, '$1`.agents/skills/$2/SKILL.md`')
    .replace(/(^|[^./A-Za-z0-9_-])([a-z0-9_-]+)\/skill\.md\b/gim, '$1.agents/skills/$2/SKILL.md')
    .replace(/`\.claude\/graph\.json`/g, '`.agents/skills/architecture/references/code-map.md`')
    .replace(/Generate skills, hooks, and `AGENTS\.md`/g, 'Generate Codex project docs and skills')
    .replace(/Generate skills and `AGENTS\.md`/g, 'Generate Codex project docs and skills')
    .replace(/Update docs from recent diffs/g, 'Update Codex project docs from recent diffs')
    .replace(/rebuild `\.claude\/graph\.json`/g, 'refresh import graph artifacts')
    .replace(/rebuild `\.codex\/graph\.json`/g, 'refresh import graph artifacts')
    .replace(/(\n){3,}/g, '\n\n')
    .trim();
}

function sanitizeCodexSkill(content) {
  const filteredLines = content
    .split('\n')
    .filter(line =>
      !/\.claude\/hooks/i.test(line) &&
      !/\.codex\/hooks/i.test(line) &&
      !/generated Claude skills/i.test(line) &&
      !/skill-rules\.json/i.test(line) &&
      !/hook compatibility/i.test(line) &&
      !/customize agents/i.test(line)
    );

  return filteredLines
    .join('\n')
    .replace(/Claude Code skills and CLAUDE\.md/g, 'project skills and instruction docs')
    .replace(/Claude Code skills and AGENTS\.md/g, 'project skills and AGENTS.md')
    .replace(/into their \.claude\/ directories/g, 'into target-specific directories')
    .replace(/into their \.codex\/ directories/g, 'into target-specific directories')
    .replace(/CLAUDE\.md/g, 'AGENTS.md')
    .replace(/`base\/skill\.md`/g, '`.agents/skills/base/SKILL.md`')
    .replace(/\bbase\/skill\.md\b/g, '.agents/skills/base/SKILL.md')
    .replace(/(^|[^./A-Za-z0-9_-])`([a-z0-9_-]+)\/skill\.md`/gim, '$1`.agents/skills/$2/SKILL.md`')
    .replace(/(^|[^./A-Za-z0-9_-])([a-z0-9_-]+)\/skill\.md\b/gim, '$1.agents/skills/$2/SKILL.md')
    .replace(/rebuild `\.claude\/graph\.json`/g, 'refresh import graph artifacts')
    .replace(/rebuild `\.codex\/graph\.json`/g, 'refresh import graph artifacts')
    .replace(/(\n){3,}/g, '\n\n')
    .trim() + '\n';
}

function extractDomainName(skillPath, target) {
  const prefix = target.skillsDir + '/';
  if (!skillPath.startsWith(prefix)) return null;
  const rest = skillPath.slice(prefix.length);
  return rest.split('/')[0];
}

// Source-skillsDir-agnostic version. Skill files always live at
// `<skillsDir>/<domainName>/<filename>` so the domain name is the
// second-to-last path segment regardless of whether the source is
// Claude (`.claude/skills/...`) or Codex (`.agents/skills/...`).
function extractDomainFromAnyPath(skillPath) {
  const parts = skillPath.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function resolveDomainDirectory(domainName, scanResult) {
  if (!scanResult?.domains) return null;

  const domain = scanResult.domains.find(item =>
    item.name === domainName || item.name.toLowerCase() === domainName.toLowerCase()
  );

  if (domain?.directories?.length) {
    return domain.directories[0];
  }

  return null;
}

function escapeRegex(str) {
  let result = str;
  for (const char of ['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']) {
    result = result.replaceAll(char, '\\' + char);
  }
  return result;
}

/**
 * Map a Claude-format path (CLAUDE.md, .claude/skills/<name>/skill.md) to the
 * corresponding path under another target. Returns the input unchanged when
 * the destination target is Claude itself, or `null` when the path doesn't
 * correspond to a known target slot.
 *
 * @param {string} targetId — destination target id ('claude' | 'codex')
 * @param {string} claudePath — source path in Claude format
 * @returns {string|null}
 */
export function transformPathForTarget(targetId, claudePath) {
  const claude = TARGETS.claude;
  const dest = TARGETS[targetId];
  if (!dest) return null;
  if (dest.id === claude.id) return claudePath;

  if (claudePath === claude.instructionsFile) return dest.instructionsFile;

  const skillsPrefix = claude.skillsDir + '/';
  if (claudePath.startsWith(skillsPrefix)) {
    const rest = claudePath.slice(skillsPrefix.length);
    const parts = rest.split('/');
    if (parts.length >= 2) {
      const domain = parts[0];
      return join(dest.skillsDir, domain, dest.skillFilename);
    }
  }

  return null;
}

/**
 * Logical role of a published file under a given target — used by parity checks
 * so we compare logical slots (root-instructions, per-domain skill) rather than
 * raw paths that differ across targets.
 *
 * Returns null for codex-only derived files (directory-scoped AGENTS.md inside
 * a domain dir): those have no Claude counterpart by design.
 */
function logicalKeyForFile(filePath, target) {
  if (filePath === target.instructionsFile) return 'INSTRUCTIONS';

  const skillsPrefix = (target.skillsDir || '') + '/';
  if (target.skillsDir && filePath.startsWith(skillsPrefix)) {
    const rest = filePath.slice(skillsPrefix.length);
    const domain = rest.split('/')[0];
    return `SKILL:${domain}`;
  }

  // Codex-only directory-scoped AGENTS.md inside a domain dir (not the root)
  if (
    target.directoryDocFile &&
    filePath.endsWith('/' + target.directoryDocFile) &&
    filePath !== target.directoryDocFile
  ) {
    return null;
  }

  return `OTHER:${filePath}`;
}

/**
 * Phase 4 parity validator. Asserts that every configured target publishes the
 * same set of logical files (root instructions + per-domain skills). Codex
 * directory-scoped AGENTS.md files are excluded from the check — they have no
 * Claude counterpart by design.
 *
 * @param {Map<string, Array<{path:string,content:string}>>} perTargetMap
 * @throws {CliError} when targets diverge
 */
export function assertTargetParity(perTargetMap) {
  const targetIds = [...perTargetMap.keys()];
  if (targetIds.length < 2) return;

  const keysByTarget = new Map();
  for (const targetId of targetIds) {
    const target = TARGETS[targetId];
    if (!target) continue;
    const keys = new Set();
    for (const file of perTargetMap.get(targetId) || []) {
      const key = logicalKeyForFile(file.path, target);
      if (key) keys.add(key);
    }
    keysByTarget.set(targetId, keys);
  }

  const [firstId, ...restIds] = targetIds;
  const firstKeys = keysByTarget.get(firstId) || new Set();

  for (const otherId of restIds) {
    const otherKeys = keysByTarget.get(otherId) || new Set();
    const missingInOther = [...firstKeys].filter(k => !otherKeys.has(k));
    const missingInFirst = [...otherKeys].filter(k => !firstKeys.has(k));
    if (missingInOther.length === 0 && missingInFirst.length === 0) continue;

    const lines = [`Target parity violation between '${firstId}' and '${otherId}':`];
    if (missingInOther.length) lines.push(`  Missing in ${otherId}: ${missingInOther.join(', ')}`);
    if (missingInFirst.length) lines.push(`  Missing in ${firstId}: ${missingInFirst.join(', ')}`);
    throw new CliError(lines.join('\n'));
  }
}

export function validateTransformedFiles(files) {
  const issues = [];

  for (const file of files) {
    const filePath = file.path;

    if (filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
      issues.push('Absolute path not allowed: ' + filePath);
      continue;
    }

    if (filePath.includes('..')) {
      issues.push('Path traversal not allowed: ' + filePath);
      continue;
    }

    const isKnownDocFile =
      filePath.endsWith('AGENTS.md') ||
      filePath.endsWith('SKILL.md') ||
      filePath.endsWith('CLAUDE.md');
    const isUnderSkillsDir =
      filePath.startsWith('.agents/skills/') ||
      filePath.startsWith('.claude/skills/');

    if (!isKnownDocFile && !isUnderSkillsDir) {
      issues.push('Unexpected filename: ' + filePath);
    }
  }

  return { valid: issues.length === 0, issues };
}
