import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { execSync } from 'child_process';
import { SOURCE_EXTS } from './source-exts.js';

/**
 * Build context string from a repo scan result.
 * Reads key files and assembles them into a prompt-friendly format.
 */
export function buildContext(repoPath, scanResult, options = {}) {
  const { maxFiles = 30, maxFileLines = 100 } = options;
  const sections = [];
  let fileCount = 0;
  const readFiles = new Set(); // dedup

  function trackFile(filePath) {
    if (readFiles.has(filePath)) return false;
    if (fileCount >= maxFiles) return false;
    readFiles.add(filePath);
    fileCount++;
    return true;
  }

  // 1. Scan results as JSON (strip absolute paths for token efficiency)
  const cleanScan = { ...scanResult, path: undefined };
  sections.push('## Scan Results\n```json\n' + JSON.stringify(cleanScan, null, 2) + '\n```');

  // 2. Package manifests (full)
  const manifests = [
    'package.json', 'pyproject.toml', 'requirements.txt',
    'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json',
    'Makefile', 'makefile',
  ];
  for (const manifest of manifests) {
    const fullPath = join(repoPath, manifest);
    if (trackFile(fullPath)) {
      const content = readFileSafe(fullPath);
      if (content) {
        sections.push(`## ${manifest}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  }

  // 3. Config files (high value for skill generation)
  const configs = [
    'tsconfig.json', 'tsconfig.base.json',
    'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs',
    '.eslintrc.json', '.eslintrc.js', 'eslint.config.js', 'eslint.config.mjs',
    'biome.json', 'biome.jsonc',
    '.env.example', '.env.local.example',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'vite.config.ts', 'vite.config.js',
  ];
  for (const config of configs) {
    const fullPath = join(repoPath, config);
    if (existsSync(fullPath) && trackFile(fullPath)) {
      const content = readFileSafe(fullPath, maxFileLines);
      if (content) {
        sections.push(`## ${config}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  }

  // 4. Entry points (full content, usually short)
  for (const entry of scanResult.entryPoints) {
    const fullPath = join(repoPath, entry);
    if (trackFile(fullPath)) {
      const content = readFileSafe(fullPath, maxFileLines);
      if (content) {
        sections.push(`## ${entry}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  }

  // 5. Directory listings for key dirs
  for (const [role, dir] of Object.entries(scanResult.structure.keyDirs)) {
    if (fileCount >= maxFiles) break;
    const listing = listDirRecursive(join(repoPath, dir), 3);
    if (listing) {
      sections.push(`## Directory: ${dir}/ (${role})\n\`\`\`\n${listing}\n\`\`\``);
      fileCount++;
    }
  }

  // 6. Sample files from each domain
  for (const domain of scanResult.domains) {
    if (fileCount >= maxFiles) break;

    const filesToRead = [];

    // From directories — read top-level source files
    for (const dir of (domain.directories || [])) {
      const fullDir = join(repoPath, dir);
      if (existsSync(fullDir)) {
        filesToRead.push(...listSourceFiles(fullDir).slice(0, 2));
      }
    }

    // From file hints
    for (const file of (domain.files || []).slice(0, 2)) {
      filesToRead.push(join(repoPath, file));
    }

    for (const file of filesToRead.slice(0, 3)) {
      if (trackFile(file)) {
        const content = readFileSafe(file, maxFileLines);
        if (content) {
          const relativePath = relative(repoPath, file);
          sections.push(`## ${relativePath} (domain: ${domain.name})\n\`\`\`\n${content}\n\`\`\``);
        }
      }
    }
  }

  // 7. Existing instructions file (CLAUDE.md or AGENTS.md) if present
  const instructionsFile = options.instructionsFile || 'CLAUDE.md';
  const instructionsPath = join(repoPath, instructionsFile);
  if (existsSync(instructionsPath)) {
    const content = readFileSafe(instructionsPath);
    if (content) {
      sections.push(`## Existing ${instructionsFile}\n\`\`\`markdown\n${content}\n\`\`\``);
    }
  }
  // Also check alternative instructions files for improve strategy (both may exist)
  const defaultAlternatives = instructionsFile === 'CLAUDE.md' ? ['AGENTS.md'] : ['CLAUDE.md'];
  const instructionAlternatives = options.instructionsAlternatives
    || (options.altInstructionsFile ? [options.altInstructionsFile] : defaultAlternatives);
  for (const altInstructionsFile of instructionAlternatives) {
    if (!altInstructionsFile || altInstructionsFile === instructionsFile) continue;
    const altPath = join(repoPath, altInstructionsFile);
    if (existsSync(altPath)) {
      const altContent = readFileSafe(altPath);
      if (altContent) {
        sections.push(`## Existing ${altInstructionsFile}\n\`\`\`markdown\n${altContent}\n\`\`\``);
      }
    }
  }

  // 8. Git log for recent activity context
  const gitLog = getGitLog(repoPath);
  if (gitLog) {
    sections.push(`## Recent Git History\n\`\`\`\n${gitLog}\n\`\`\``);
  }

  return sections.join('\n\n---\n\n');
}

// --- Helpers ---

function readFileSafe(filePath, maxLines = null) {
  try {
    let content = readFileSync(filePath, 'utf8');
    if (maxLines) {
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        content = lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
      }
    }
    return content;
  } catch {
    return null;
  }
}

function listDirRecursive(dirPath, maxDepth, currentDepth = 0, prefix = '') {
  try {
    const entries = readdirSync(dirPath);
    const lines = [];

    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__' || entry === '.git') continue;

      const full = join(dirPath, entry);
      const isDirectory = statSync(full).isDirectory();

      lines.push(`${prefix}${entry}${isDirectory ? '/' : ''}`);

      if (isDirectory && currentDepth < maxDepth) {
        const subLines = listDirRecursive(full, maxDepth, currentDepth + 1, prefix + '  ');
        if (subLines) lines.push(subLines);
      }
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}

function listSourceFiles(dirPath) {
  try {
    return readdirSync(dirPath)
      .filter(f => SOURCE_EXTS.has(extname(f)))
      .map(f => join(dirPath, f));
  } catch {
    return [];
  }
}

/**
 * Build focused context for a single domain.
 * Used in chunked mode — each domain skill gets its own Claude call.
 */
export function buildDomainContext(repoPath, scanResult, domain, options = {}) {
  const { maxFileLines = 150, maxFiles = 15 } = options;
  const sections = [];
  const readFiles = new Set();

  // 1. Brief repo summary (not full scan — just enough for orientation)
  sections.push(`## Repository: ${scanResult.name} (${scanResult.repoType})\nTech: ${scanResult.frameworks.join(', ')}`);

  // 2. All files from this domain — more generous than full-repo mode
  const filesToRead = [];

  for (const dir of (domain.directories || [])) {
    const fullDir = join(repoPath, dir);
    if (existsSync(fullDir)) {
      filesToRead.push(...listSourceFiles(fullDir));
    }
  }

  for (const file of (domain.files || [])) {
    filesToRead.push(join(repoPath, file));
  }

  for (const file of filesToRead) {
    if (readFiles.has(file)) continue;
    if (readFiles.size >= maxFiles) break;
    readFiles.add(file);
    const content = readFileSafe(file, maxFileLines);
    if (content) {
      const relativePath = relative(repoPath, file);
      sections.push(`## ${relativePath}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  // 3. Directory listing for domain dirs
  for (const dir of (domain.directories || [])) {
    const listing = listDirRecursive(join(repoPath, dir), 3);
    if (listing) {
      sections.push(`## Directory: ${dir}/\n\`\`\`\n${listing}\n\`\`\``);
    }
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Build context for base skill only — repo structure, manifests, entry points.
 * Excludes domain-specific files (those get their own calls).
 */
export function buildBaseContext(repoPath, scanResult, options = {}) {
  const { maxFileLines = 100 } = options;
  const sections = [];

  // Scan results (stripped of absolute path)
  const cleanScan = { ...scanResult, path: undefined };
  sections.push('## Scan Results\n```json\n' + JSON.stringify(cleanScan, null, 2) + '\n```');

  // Manifests
  const manifests = [
    'package.json', 'pyproject.toml', 'requirements.txt',
    'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json',
    'Makefile', 'makefile',
  ];
  for (const manifest of manifests) {
    const content = readFileSafe(join(repoPath, manifest));
    if (content) {
      sections.push(`## ${manifest}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  // Config files
  const configs = [
    'tsconfig.json', '.eslintrc.json', 'eslint.config.js', 'biome.json',
    '.env.example', '.env.local.example',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'vite.config.ts', 'vite.config.js',
  ];
  for (const config of configs) {
    const fullPath = join(repoPath, config);
    if (existsSync(fullPath)) {
      const content = readFileSafe(fullPath, maxFileLines);
      if (content) {
        sections.push(`## ${config}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
  }

  // Entry points
  for (const entry of scanResult.entryPoints) {
    const content = readFileSafe(join(repoPath, entry), maxFileLines);
    if (content) {
      sections.push(`## ${entry}\n\`\`\`\n${content}\n\`\`\``);
    }
  }

  // Key directory listings
  for (const [role, dir] of Object.entries(scanResult.structure.keyDirs)) {
    const listing = listDirRecursive(join(repoPath, dir), 3);
    if (listing) {
      sections.push(`## Directory: ${dir}/ (${role})\n\`\`\`\n${listing}\n\`\`\``);
    }
  }

  // Git log
  const gitLog = getGitLog(repoPath);
  if (gitLog) {
    sections.push(`## Recent Git History\n\`\`\`\n${gitLog}\n\`\`\``);
  }

  return sections.join('\n\n---\n\n');
}

function getGitLog(repoPath) {
  try {
    return execSync('git log --oneline -20', {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
