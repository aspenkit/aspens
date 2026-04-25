/**
 * Content transform system for multi-target output.
 *
 * Canonical generation produces Claude-shaped docs first.
 * Other targets are projected from that canonical output.
 */

import { join } from 'path';
import { readFileSync } from 'fs';

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
      content = syncCodexSkillsSection(content, baseSkill, domainSkills, destTarget, !!graphSerialized);
    }
    sections.push(content.trim());
  } else if (baseSkill) {
    let content = baseSkill.content;
    content = stripActivationSection(content);
    content = remapContentPaths(content, { instructionsFile: 'CLAUDE.md', skillsDir: '.claude/skills', skillFilename: 'skill.md', configDir: '.claude' }, destTarget);
    if (destTarget.id === 'codex') {
      content = sanitizeCodexInstructions(content);
      content = syncCodexSkillsSection(content, baseSkill, domainSkills, destTarget, !!graphSerialized);
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

export function ensureRootKeyFilesSection(content, graphSerialized) {
  if (!content || !graphSerialized?.hubs?.length) return content;

  const section = buildHubFilesSection(graphSerialized);
  if (!section) return content;

  const trimmed = content.trimEnd();
  const keyFilesSectionRegex = /## Key Files\s*\n[\s\S]*?(?=\n## |\n\*\*Last Updated|$)/;

  if (keyFilesSectionRegex.test(trimmed)) {
    return trimmed.replace(keyFilesSectionRegex, section).replace(/(\n){3,}/g, '\n\n') + '\n';
  }

  const behaviorIndex = trimmed.search(/\n## Behavior\b/);
  const lastUpdatedIndex = trimmed.search(/\n\*\*Last Updated\b/);
  const insertAt = behaviorIndex >= 0
    ? behaviorIndex
    : lastUpdatedIndex >= 0
      ? lastUpdatedIndex
      : trimmed.length;

  const before = trimmed.slice(0, insertAt).trimEnd();
  const after = trimmed.slice(insertAt).trimStart();

  return (
    before +
    '\n\n' +
    section +
    (after ? '\n\n' + after : '') +
    '\n'
  ).replace(/(\n){3,}/g, '\n\n');
}

function syncCodexSkillsSection(content, baseSkill, domainSkills, destTarget, hasGraph = false) {
  const skillRefs = buildCodexSkillRefs(baseSkill, domainSkills, destTarget, hasGraph);
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

function buildCodexSkillRefs(baseSkill, domainSkills, destTarget, hasGraph = false) {
  const refs = [];

  if (baseSkill) {
    refs.push('- `' + join(destTarget.skillsDir, 'base', destTarget.skillFilename) + '` — Base repo skill; load whenever working in this repo.');
  }

  for (const skill of domainSkills) {
    const domainName = extractDomainName(skill.path, { skillsDir: '.claude/skills' });
    if (!domainName) continue;
    const description = extractFrontmatterField(skill.content, 'description');
    const suffix = description ? ' — ' + description : '';
    refs.push('- `' + join(destTarget.skillsDir, domainName, destTarget.skillFilename) + '`' + suffix);
  }

  if (hasGraph) {
    refs.push('- `' + join(destTarget.skillsDir, 'architecture', destTarget.skillFilename) + '` — Import graph and code-map reference for structural changes.');
  }
  return refs;
}

function buildHubFilesSection(serializedGraph) {
  if (!serializedGraph?.hubs?.length) return null;

  const lines = ['## Key Files', '', '**Hub files (most depended-on):**'];
  for (const hub of serializedGraph.hubs.slice(0, 5)) {
    lines.push('- `' + hub.path + '` - ' + hub.fanIn + ' dependents');
  }
  lines.push('');

  return lines.join('\n');
}

function extractFrontmatterField(content, field) {
  const match = content.match(new RegExp('^' + escapeRegex(field) + ':\\s*(.+)$', 'm'));
  return match ? match[1].trim() : '';
}

function generateCondensedCodeMap(serializedGraph) {
  const lines = [];

  if (serializedGraph?.hubs?.length > 0) {
    lines.push('## Key Files');
    lines.push('');
    lines.push('**Hub files (most depended-on):**');
    for (const hub of serializedGraph.hubs.slice(0, 5)) {
      lines.push('- `' + hub.path + '` - ' + hub.fanIn + ' dependents');
    }
    lines.push('');
  }

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

  return lines.length > 0 ? lines.join('\n') : null;
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
