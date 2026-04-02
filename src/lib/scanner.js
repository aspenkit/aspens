import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';

/**
 * Scan a repository and return its tech stack, structure, and domains.
 * Fully deterministic — no LLM calls.
 */
export function scanRepo(repoPath, { extraDomains } = {}) {
  const result = {
    path: repoPath,
    name: basename(repoPath),
    languages: detectLanguages(repoPath),
    frameworks: detectFrameworks(repoPath),
    structure: detectStructure(repoPath),
    domains: detectDomains(repoPath),
    entryPoints: detectEntryPoints(repoPath),
    hasClaudeConfig: existsSync(join(repoPath, '.claude')),
    hasClaudeMd: existsSync(join(repoPath, 'CLAUDE.md')),
    hasCodexConfig: existsSync(join(repoPath, '.codex')),
    hasAgentsMd: existsSync(join(repoPath, 'AGENTS.md')),
  };

  // Merge user-specified domains
  if (extraDomains && extraDomains.length > 0) {
    mergeExtraDomains(result, repoPath, extraDomains);
  }

  result.repoType = inferRepoType(result);
  result.size = estimateRepoSize(repoPath);
  result.health = checkHealth(repoPath, result);

  return result;
}

function mergeExtraDomains(result, repoPath, extraDomains) {
  const sourceRoot = findSourceRoot(repoPath);
  const existingNames = new Set(result.domains.map(d => d.name));

  for (const name of extraDomains) {
    if (existingNames.has(name)) continue;

    const candidates = [
      sourceRoot ? join(sourceRoot, name) : null,
      join(repoPath, name),
    ].filter(Boolean);

    const matchedDir = candidates.find(d => existsSync(d) && isDir(d));

    if (matchedDir) {
      const modules = collectModules(matchedDir, 3);
      result.domains.push({
        name,
        directories: [relative(repoPath, matchedDir)],
        modules,
        files: [],
        userSpecified: true,
        sourceFileCount: modules.length || undefined,
      });
    } else {
      result.domains.push({
        name,
        directories: [],
        modules: [],
        files: [],
        userSpecified: true,
      });
    }
  }
}

// --- Repo Size Estimation ---

function estimateRepoSize(repoPath) {
  let sourceFiles = 0;
  let totalLines = 0;

  function walk(dir, depth) {
    if (depth > 5) return; // don't go too deep
    let entries;
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__' ||
          entry === 'dist' || entry === 'build' || entry === '.next' || entry === 'vendor' ||
          entry === '.git' || entry === 'coverage') continue;

      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (SOURCE_EXTS.has(extname(entry))) {
          sourceFiles++;
          totalLines += Math.ceil(stat.size / 40);
        }
      } catch {}
    }
  }

  walk(repoPath, 0);

  // Categorize
  let category;
  if (sourceFiles <= 50) category = 'small';
  else if (sourceFiles <= 200) category = 'medium';
  else if (sourceFiles <= 500) category = 'large';
  else category = 'very-large';

  return { sourceFiles, estimatedLines: totalLines, category };
}

// --- Language Detection ---

function detectLanguages(repoPath) {
  const indicators = {
    javascript: ['package.json'],
    typescript: ['tsconfig.json', 'tsconfig.base.json'],
    python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'poetry.lock'],
    go: ['go.mod'],
    rust: ['Cargo.toml'],
    ruby: ['Gemfile'],
    java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    csharp: () => globShallow(repoPath, '.csproj') || globShallow(repoPath, '.sln') || globRecursive(repoPath, '.csproj', 3),
    swift: ['Package.swift'],
    php: ['composer.json'],
    elixir: ['mix.exs'],
  };

  const found = [];
  for (const [lang, files] of Object.entries(indicators)) {
    if (typeof files === 'function') {
      if (files()) found.push(lang);
    } else if (files.some(f => existsSync(join(repoPath, f)))) {
      found.push(lang);
    }
  }

  // TypeScript implies JavaScript
  if (found.includes('typescript') && !found.includes('javascript')) {
    found.push('javascript');
  }

  return found;
}

// --- Framework Detection ---

function detectFrameworks(repoPath) {
  const found = [];

  // JS/TS frameworks
  const pkg = readJson(join(repoPath, 'package.json'));
  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const jsMappings = {
      'next': 'nextjs',
      'react': 'react',
      'vue': 'vue',
      '@angular/core': 'angular',
      'svelte': 'svelte',
      'express': 'express',
      'fastify': 'fastify',
      'nestjs': 'nestjs',
      '@nestjs/core': 'nestjs',
      'hono': 'hono',
      'astro': 'astro',
      'remix': 'remix',
      '@remix-run/node': 'remix',
      'nuxt': 'nuxt',
      'gatsby': 'gatsby',
      'electron': 'electron',
      'tailwindcss': 'tailwind',
      '@mui/material': 'material-ui',
      'shadcn': 'shadcn',
      'prisma': 'prisma',
      '@prisma/client': 'prisma',
      'drizzle-orm': 'drizzle',
      'mongoose': 'mongoose',
      'vitest': 'vitest',
      'jest': 'jest',
      'playwright': 'playwright',
      'cypress': 'cypress',
      'storybook': 'storybook',
      '@storybook/react': 'storybook',
    };

    for (const [dep, framework] of Object.entries(jsMappings)) {
      if (allDeps[dep] && !found.includes(framework)) {
        found.push(framework);
      }
    }

    // shadcn detection via components.json
    if (existsSync(join(repoPath, 'components.json'))) {
      if (!found.includes('shadcn')) found.push('shadcn');
    }
  }

  // Next.js config detection
  const nextConfigs = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
  if (nextConfigs.some(f => existsSync(join(repoPath, f))) && !found.includes('nextjs')) {
    found.push('nextjs');
  }

  // Python frameworks
  const pyDeps = readPythonDeps(repoPath);
  const pyMappings = {
    'fastapi': 'fastapi',
    'django': 'django',
    'flask': 'flask',
    'starlette': 'starlette',
    'pydantic': 'pydantic',
    'sqlalchemy': 'sqlalchemy',
    'alembic': 'alembic',
    'pytest': 'pytest',
    'celery': 'celery',
    'supabase': 'supabase',
    'httpx': 'httpx',
    'uvicorn': 'uvicorn',
  };

  for (const [dep, framework] of Object.entries(pyMappings)) {
    if (pyDeps.has(dep) && !found.includes(framework)) {
      found.push(framework);
    }
  }

  // Go frameworks
  const goMod = readFileContent(join(repoPath, 'go.mod'));
  if (goMod) {
    const goMappings = {
      'gin-gonic/gin': 'gin',
      'labstack/echo': 'echo',
      'gofiber/fiber': 'fiber',
      'gorilla/mux': 'gorilla',
    };
    for (const [dep, framework] of Object.entries(goMappings)) {
      if (goMod.includes(dep)) found.push(framework);
    }
  }

  // Ruby frameworks
  const gemfile = readFileContent(join(repoPath, 'Gemfile'));
  if (gemfile) {
    if (gemfile.includes("'rails'") || gemfile.includes('"rails"')) found.push('rails');
    if (gemfile.includes("'sinatra'") || gemfile.includes('"sinatra"')) found.push('sinatra');
  }

  // Docker
  if (existsSync(join(repoPath, 'Dockerfile')) || existsSync(join(repoPath, 'docker-compose.yml')) || existsSync(join(repoPath, 'docker-compose.yaml'))) {
    found.push('docker');
  }

  return found;
}

// --- Structure Detection ---

function detectStructure(repoPath) {
  const topLevel = listDir(repoPath);
  const dirs = topLevel.filter(f => {
    const full = join(repoPath, f);
    return !f.startsWith('.') && !f.startsWith('node_modules') && isDir(full);
  });

  const structure = {
    topDirs: dirs,
    srcDir: null,
    hasMonorepo: false,
    keyDirs: {},
  };

  // Find the main source directory
  const srcCandidates = ['src', 'app', 'lib', 'server', 'api', 'pages', 'routes'];
  for (const candidate of srcCandidates) {
    if (dirs.includes(candidate)) {
      structure.srcDir = candidate;
      break;
    }
  }

  // Monorepo detection
  if (dirs.includes('packages') || dirs.includes('apps') || existsSync(join(repoPath, 'lerna.json')) || existsSync(join(repoPath, 'pnpm-workspace.yaml'))) {
    structure.hasMonorepo = true;
  }

  // Map key directories
  const sourceRoot = structure.srcDir ? join(repoPath, structure.srcDir) : repoPath;
  if (existsSync(sourceRoot) && isDir(sourceRoot)) {
    const srcDirs = listDir(sourceRoot).filter(f => !f.startsWith('.') && isDir(join(sourceRoot, f)));

    const keyPatterns = {
      components: ['components', 'ui', 'views'],
      pages: ['pages', 'routes', 'screens', 'views'],
      services: ['services', 'api', 'endpoints'],
      hooks: ['hooks', 'composables'],
      lib: ['lib'],
      utils: ['utils', 'helpers', 'common'],
      models: ['models', 'entities', 'schemas', 'types'],
      middleware: ['middleware', 'middlewares'],
      config: ['config', 'configuration', 'settings'],
      tests: ['tests', 'test', '__tests__', 'spec'],
      database: ['db', 'database', 'migrations', 'prisma'],
    };

    for (const [key, patterns] of Object.entries(keyPatterns)) {
      const match = srcDirs.find(d => patterns.includes(d.toLowerCase()));
      if (match) structure.keyDirs[key] = join(structure.srcDir || '.', match);
    }
  }

  return structure;
}

// --- Domain Detection ---

// Always skip — purely structural, build output, dependencies, IDE
const SKIP_DIR_NAMES = new Set([
  'src', 'app', 'bin', 'cmd', 'pkg', 'internal', 'vendor',
  'dist', 'build', 'out', 'output', 'target', 'coverage',
  'node_modules', '__pycache__', '.next', '.nuxt', '.cache',
  '.github', '.vscode', '.idea', '.git',
  'assets', 'static', 'public', 'images', 'icons', 'fonts',
  'styles', 'css',
]);

function detectDomains(repoPath) {
  const domains = [];
  const sourceRoot = findSourceRoot(repoPath);

  // Scan directories under source root AND at repo root
  const scanRoots = new Set();
  if (sourceRoot) scanRoots.add(sourceRoot);
  scanRoots.add(repoPath);

  const seen = new Set(); // avoid duplicates when sourceRoot === repoPath

  for (const root of scanRoots) {
    const entries = listDir(root);
    for (const entry of entries) {
      const name = entry.toLowerCase();
      if (name.startsWith('.')) continue;
      if (SKIP_DIR_NAMES.has(name)) continue;

      const full = join(root, entry);
      const relDir = relative(repoPath, full);
      if (seen.has(relDir)) continue;
      seen.add(relDir);

      if (!isDir(full)) continue;

      // Collect modules (source file stems) inside this directory
      const modules = collectModules(full, 3);
      if (modules.length === 0) continue;

      domains.push({
        name: name,
        directories: [relDir],
        modules: modules,
        files: [],
        sourceFileCount: modules.length,
      });
    }
  }

  return domains;
}

/**
 * Collect source file names (without extension) from a directory tree.
 * Skips __init__.py, index.js/ts and similar boilerplate entry files.
 */
const BOILERPLATE_STEMS = new Set(['__init__', 'index', 'mod']);

function collectModules(dirPath, maxDepth, depth = 0) {
  if (depth >= maxDepth) return [];
  const results = [];
  const entries = listDir(dirPath);

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__') continue;
    const full = join(dirPath, entry);
    const ext = extname(entry);

    if (SOURCE_EXTS.has(ext)) {
      const stem = basename(entry, ext);
      if (!BOILERPLATE_STEMS.has(stem)) {
        results.push(stem);
      }
    } else if (isDir(full)) {
      // For subdirectories, add the dir name as a module if it has source files
      const subModules = collectModules(full, maxDepth, depth + 1);
      if (subModules.length > 0) {
        results.push(basename(full) + '/');
      }
    }
  }

  return results;
}

// --- Entry Points ---

export function detectEntryPoints(repoPath) {
  const entries = [];
  const candidates = [
    // JS/TS
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/app.ts', 'src/app.js', 'app/layout.tsx', 'app/page.tsx',
    'pages/index.tsx', 'pages/index.js', 'pages/_app.tsx',
    'index.ts', 'index.js', 'server.ts', 'server.js',
    // Python
    'app/main.py', 'main.py', 'app/__init__.py', 'manage.py', 'wsgi.py', 'asgi.py',
    'src/main.py', 'src/app.py',
    // Go
    'main.go', 'cmd/main.go',
    // Ruby
    'config.ru', 'app.rb',
  ];

  for (const candidate of candidates) {
    if (existsSync(join(repoPath, candidate))) {
      entries.push(candidate);
    }
  }

  return entries;
}

// --- Repo Type Inference ---

function inferRepoType(scanResult) {
  const { frameworks, structure, languages } = scanResult;

  const frontendFrameworks = ['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'gatsby', 'remix', 'astro'];
  const backendFrameworks = ['express', 'fastify', 'nestjs', 'hono', 'fastapi', 'django', 'flask', 'rails', 'sinatra', 'gin', 'echo', 'fiber'];

  const hasFrontend = frameworks.some(f => frontendFrameworks.includes(f));
  const hasBackend = frameworks.some(f => backendFrameworks.includes(f));

  if (structure.hasMonorepo) return 'monorepo';
  if (hasFrontend && hasBackend) return 'fullstack';
  if (hasFrontend) return 'frontend';
  if (hasBackend) return 'backend';
  if (languages.includes('python') && !hasBackend) return 'library';
  if (frameworks.includes('electron')) return 'desktop';

  return 'unknown';
}

// --- Health Checks ---

function checkHealth(repoPath, scanResult) {
  const issues = [];

  const gitignorePath = join(repoPath, '.gitignore');
  const hasGitignore = existsSync(gitignorePath);

  if (!hasGitignore) {
    issues.push({
      level: 'warn',
      id: 'no-gitignore',
      message: 'No .gitignore found',
      detail: 'Installing dependencies (npm install, pip install, etc.) will pollute your git history with thousands of files.',
      fix: 'Add a .gitignore file — most frameworks provide one via their init/create commands.',
    });
  } else {
    const content = readFileContent(gitignorePath) || '';
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    // Check language-specific ignores
    const langs = scanResult.languages || [];
    const hasJS = langs.includes('javascript') || langs.includes('typescript');
    const hasPython = langs.includes('python');
    const hasRust = langs.includes('rust');

    if (hasJS && !lines.some(l => l === 'node_modules' || l === 'node_modules/' || l === '/node_modules' || l === '/node_modules/')) {
      issues.push({
        level: 'warn',
        id: 'missing-node-modules-ignore',
        message: 'node_modules/ is not in .gitignore',
        detail: 'Running npm install will add hundreds of files to git.',
        fix: 'Add node_modules/ to your .gitignore',
      });
    }

    if (hasPython && !lines.some(l => l === '__pycache__' || l === '__pycache__/' || l.includes('__pycache__') || l === '*.pyc')) {
      issues.push({
        level: 'warn',
        id: 'missing-pycache-ignore',
        message: '__pycache__/ is not in .gitignore',
        fix: 'Add __pycache__/ and *.pyc to your .gitignore',
      });
    }

    if (hasPython && !lines.some(l => l === '.venv' || l === '.venv/' || l === 'venv' || l === 'venv/' || l === 'env' || l === 'env/')) {
      issues.push({
        level: 'info',
        id: 'missing-venv-ignore',
        message: 'Virtual environment directory not in .gitignore',
        fix: 'Add .venv/ to your .gitignore',
      });
    }

    if (hasRust && !lines.some(l => l === 'target' || l === 'target/' || l === '/target')) {
      issues.push({
        level: 'warn',
        id: 'missing-target-ignore',
        message: 'target/ is not in .gitignore',
        fix: 'Add target/ to your .gitignore',
      });
    }
  }

  // Check for .env files that might be committed
  if (existsSync(join(repoPath, '.env'))) {
    const gitignoreContent = hasGitignore ? (readFileContent(gitignorePath) || '') : '';
    const lines = gitignoreContent.split('\n').map(l => l.trim());
    if (!lines.some(l => l === '.env' || l === '.env*' || l === '.env.*' || l === '*.env')) {
      issues.push({
        level: 'warn',
        id: 'env-not-ignored',
        message: '.env file exists but is not in .gitignore',
        detail: 'This may leak secrets (API keys, passwords) into your git history.',
        fix: 'Add .env to your .gitignore',
      });
    }
  }

  return { issues };
}

// --- Helpers ---

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readFileContent(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readPythonDeps(repoPath) {
  const deps = new Set();

  // requirements.txt
  const req = readFileContent(join(repoPath, 'requirements.txt'));
  if (req) {
    for (const line of req.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        const name = trimmed.split(/[>=<!\[]/)[0].trim().toLowerCase();
        if (name) deps.add(name);
      }
    }
  }

  // pyproject.toml (basic parsing)
  const pyproject = readFileContent(join(repoPath, 'pyproject.toml'));
  if (pyproject) {
    const depSection = pyproject.match(/\[(?:project\.)?dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depSection) {
      for (const line of depSection[1].split('\n')) {
        const trimmed = line.trim().replace(/"/g, '').replace(/'/g, '');
        if (trimmed && !trimmed.startsWith('#')) {
          const name = trimmed.split(/[>=<!\[]/)[0].trim().toLowerCase();
          if (name) deps.add(name);
        }
      }
    }
  }

  // Pipfile (basic)
  const pipfile = readFileContent(join(repoPath, 'Pipfile'));
  if (pipfile) {
    for (const line of pipfile.split('\n')) {
      const match = line.match(/^(\w[\w-]*)\s*=/);
      if (match) deps.add(match[1].toLowerCase());
    }
  }

  return deps;
}

function listDir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function isDir(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function globShallow(dirPath, ext) {
  return listDir(dirPath).some(f => f.endsWith(ext));
}

function globRecursive(dirPath, ext, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return false;
  const entries = listDir(dirPath);
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'bin' || entry === 'obj') continue;
    if (entry.endsWith(ext)) return true;
    const full = join(dirPath, entry);
    if (isDir(full) && globRecursive(full, ext, maxDepth, currentDepth + 1)) return true;
  }
  return false;
}

function findSourceRoot(repoPath) {
  for (const candidate of ['src', 'app', 'lib', 'server', 'pages']) {
    const full = join(repoPath, candidate);
    if (isDir(full)) return full;
  }
  return repoPath;
}

const SOURCE_EXTS = new Set(['.py', '.ts', '.js', '.tsx', '.jsx', '.rb', '.go', '.rs']);
