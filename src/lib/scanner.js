import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, relative } from 'path';

/**
 * Scan a repository and return its tech stack, structure, and domains.
 * Fully deterministic — no LLM calls.
 */
export function scanRepo(repoPath) {
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
  };

  result.repoType = inferRepoType(result);

  return result;
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

// Directories that are scaffolding/infrastructure, not product domains
const SCAFFOLD_DIR_NAMES = new Set(['templates', 'template', 'scaffolds', 'scaffold', 'fixtures', 'mocks', 'stubs', 'examples', 'example', 'samples', 'sample', 'boilerplate', 'skeleton']);

function detectDomains(repoPath) {
  const domains = [];
  const sourceRoot = findSourceRoot(repoPath);
  if (!sourceRoot) return domains;

  // Collect all directory names up to 3 levels deep in source
  const allDirs = collectDirs(sourceRoot, 3);

  // Filter out scaffold/template directories and their children
  const productDirs = allDirs.filter(d => {
    const parts = relative(repoPath, d).split(/[/\\]/);
    return !parts.some(p => SCAFFOLD_DIR_NAMES.has(p.toLowerCase()));
  });
  const dirNames = productDirs.map(d => basename(d).toLowerCase());

  // Also collect file names (without extension) in key directories for flat-structure repos
  // e.g. backend/app/services/billing_service.py → "billing"
  const fileHints = collectFileHints(sourceRoot, repoPath, 3);

  // Common domain patterns
  const domainPatterns = {
    auth: ['auth', 'authentication', 'login', 'signup', 'session', 'oauth'],
    billing: ['billing', 'payment', 'payments', 'stripe', 'subscription', 'pricing'],
    users: ['users', 'user', 'profile', 'profiles', 'account', 'accounts'],
    admin: ['admin', 'dashboard', 'backoffice'],
    notifications: ['notifications', 'notification', 'alerts', 'emails', 'email'],
    search: ['search', 'discovery', 'explore'],
    messaging: ['messaging', 'messages', 'chat', 'conversations'],
    media: ['media', 'upload', 'uploads', 'files', 'storage', 'assets'],
    analytics: ['analytics', 'metrics', 'tracking', 'reporting', 'reports'],
    settings: ['settings', 'preferences', 'configuration'],
    onboarding: ['onboarding', 'setup', 'wizard', 'welcome'],
    api: ['api', 'endpoints', 'routes', 'graphql'],
  };

  for (const [domain, patterns] of Object.entries(domainPatterns)) {
    // Match on directory names
    const dirMatches = patterns.filter(p => dirNames.includes(p));
    const matchingDirs = productDirs.filter(d => patterns.includes(basename(d).toLowerCase()));

    // Match on file name hints (e.g. billing_service.py → "billing")
    const fileMatches = fileHints.filter(h => patterns.some(p => h.hint.includes(p)));

    if (dirMatches.length > 0 || fileMatches.length > 0) {
      domains.push({
        name: domain,
        matchedOn: [...dirMatches, ...fileMatches.map(f => f.hint)].filter((v, i, a) => a.indexOf(v) === i),
        directories: matchingDirs.map(d => relative(repoPath, d)),
        files: fileMatches.map(f => f.path),
      });
    }
  }

  return domains;
}

// --- Entry Points ---

function detectEntryPoints(repoPath) {
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

const GENERIC_FILE_NAMES = new Set(['index', 'main', 'app', 'init', 'test', 'spec', 'utils', 'helpers', 'types', 'models', 'config', 'deps', 'base', 'core', 'common', 'constants', 'middleware', 'router', 'routes', 'service', 'controller']);
const SOURCE_EXTS = new Set(['.py', '.ts', '.js', '.tsx', '.jsx', '.rb', '.go', '.rs']);

function collectFileHints(rootPath, repoPath, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  const results = [];
  const entries = listDir(rootPath);

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__' || entry === '.git') continue;

    const full = join(rootPath, entry);
    if (isDir(full)) {
      results.push(...collectFileHints(full, repoPath, maxDepth, currentDepth + 1));
    } else {
      const ext = extname(entry);
      if (SOURCE_EXTS.has(ext)) {
        const stem = basename(entry, ext).toLowerCase();
        const parts = stem.split(/[_\-.]/).filter(p => p.length > 2);
        for (const part of parts) {
          if (!GENERIC_FILE_NAMES.has(part)) {
            results.push({ hint: part, path: relative(repoPath, full) });
          }
        }
      }
    }
  }

  return results;
}

function collectDirs(rootPath, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  const results = [];
  const entries = listDir(rootPath);

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__' || entry === '.git' || entry === 'dist' || entry === 'build' || entry === '.next') {
      continue;
    }
    const full = join(rootPath, entry);
    if (isDir(full)) {
      results.push(full);
      results.push(...collectDirs(full, maxDepth, currentDepth + 1));
    }
  }

  return results;
}
