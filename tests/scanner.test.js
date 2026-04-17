import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { scanRepo } from '../src/lib/scanner.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'scanner');

function createFixture(name, files) {
  const dir = join(FIXTURES_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

beforeAll(() => {
  mkdirSync(FIXTURES_DIR, { recursive: true });
});

afterAll(() => {
  try {
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup race with other test files */ }
});

describe('scanRepo', () => {
  describe('language detection', () => {
    it('detects JavaScript from package.json', () => {
      const dir = createFixture('js-project', {
        'package.json': '{"name":"test","dependencies":{}}',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('javascript');
    });

    it('detects TypeScript from tsconfig.json', () => {
      const dir = createFixture('ts-project', {
        'package.json': '{}',
        'tsconfig.json': '{"compilerOptions":{}}',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('typescript');
      expect(scan.languages).toContain('javascript');
    });

    it('detects Python from requirements.txt', () => {
      const dir = createFixture('py-project', {
        'requirements.txt': 'fastapi\npydantic\n',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('python');
    });

    it('detects Go from go.mod', () => {
      const dir = createFixture('go-project', {
        'go.mod': 'module example.com/myapp\n\ngo 1.21\n',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('go');
    });

    it('detects Rust from Cargo.toml', () => {
      const dir = createFixture('rust-project', {
        'Cargo.toml': '[package]\nname = "myapp"\n',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('rust');
    });

    it('returns empty for unknown project', () => {
      const dir = createFixture('empty-project', {
        'README.md': '# Hello',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toHaveLength(0);
    });
  });

  describe('framework detection', () => {
    it('detects React and Next.js from package.json', () => {
      const dir = createFixture('nextjs-project', {
        'package.json': JSON.stringify({
          dependencies: { react: '^19.0.0', next: '^16.0.0' },
        }),
      });
      const scan = scanRepo(dir);
      expect(scan.frameworks).toContain('react');
      expect(scan.frameworks).toContain('nextjs');
    });

    it('detects FastAPI from requirements.txt', () => {
      const dir = createFixture('fastapi-project', {
        'requirements.txt': 'fastapi>=0.100.0\nuvicorn\npydantic\n',
      });
      const scan = scanRepo(dir);
      expect(scan.frameworks).toContain('fastapi');
      expect(scan.frameworks).toContain('uvicorn');
      expect(scan.frameworks).toContain('pydantic');
    });

    it('detects Docker from Dockerfile', () => {
      const dir = createFixture('docker-project', {
        'package.json': '{}',
        'Dockerfile': 'FROM node:18\n',
      });
      const scan = scanRepo(dir);
      expect(scan.frameworks).toContain('docker');
    });

    it('detects Tailwind from package.json', () => {
      const dir = createFixture('tailwind-project', {
        'package.json': JSON.stringify({
          devDependencies: { tailwindcss: '^4.0.0' },
        }),
      });
      const scan = scanRepo(dir);
      expect(scan.frameworks).toContain('tailwind');
    });
  });

  describe('structure detection', () => {
    it('finds src as source root', () => {
      const dir = createFixture('src-project', {
        'package.json': '{}',
        'src/index.ts': 'export {}',
        'src/components/Button.tsx': 'export {}',
      });
      const scan = scanRepo(dir);
      expect(scan.structure.srcDir).toBe('src');
    });

    it('finds app as source root', () => {
      const dir = createFixture('app-project', {
        'requirements.txt': 'fastapi\n',
        'app/main.py': 'from fastapi import FastAPI',
        'app/services/billing.py': '',
      });
      const scan = scanRepo(dir);
      expect(scan.structure.srcDir).toBe('app');
    });

    it('detects monorepo', () => {
      const dir = createFixture('monorepo-project', {
        'package.json': '{}',
        'packages/web/package.json': '{}',
        'packages/api/package.json': '{}',
      });
      const scan = scanRepo(dir);
      expect(scan.structure.hasMonorepo).toBe(true);
    });

    it('maps key directories', () => {
      const dir = createFixture('structured-project', {
        'package.json': '{}',
        'src/components/Button.tsx': '',
        'src/hooks/useAuth.ts': '',
        'src/utils/helpers.ts': '',
        'src/types/index.ts': '',
      });
      const scan = scanRepo(dir);
      expect(scan.structure.keyDirs.components).toBe('src/components');
      expect(scan.structure.keyDirs.hooks).toBe('src/hooks');
      expect(scan.structure.keyDirs.utils).toBe('src/utils');
      expect(scan.structure.keyDirs.models).toBe('src/types');
    });
  });

  describe('domain detection', () => {
    it('detects auth domain from directory', () => {
      const dir = createFixture('auth-project', {
        'package.json': '{}',
        'src/auth/login.ts': '',
        'src/auth/signup.ts': '',
      });
      const scan = scanRepo(dir);
      expect(scan.domains.some(d => d.name === 'auth')).toBe(true);
    });

    it('detects billing domain from directory', () => {
      const dir = createFixture('billing-project', {
        'requirements.txt': 'fastapi\n',
        'app/billing/invoice_service.py': 'class InvoiceService: pass',
        'app/billing/stripe_client.py': 'class StripeClient: pass',
      });
      const scan = scanRepo(dir);
      expect(scan.domains.some(d => d.name === 'billing')).toBe(true);
    });

    it('filters out skipped directories', () => {
      const dir = createFixture('scaffold-project', {
        'package.json': '{}',
        'src/assets/settings/theme.js': 'export default {}',
        'src/auth/Login.tsx': '',
      });
      const scan = scanRepo(dir);
      // assets is in SKIP_DIR_NAMES so settings under it should NOT appear as a domain
      const settingsDomain = scan.domains.find(d => d.name === 'settings');
      expect(settingsDomain).toBeUndefined();
      // auth should still be detected (direct subdirectory of src with source files)
      expect(scan.domains.some(d => d.name === 'auth')).toBe(true);
    });

    it('detects domains from C# source files', () => {
      const dir = createFixture('csharp-project', {
        'MyApp.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
        'Controllers/UsersController.cs': 'public class UsersController {}',
        'Controllers/OrdersController.cs': 'public class OrdersController {}',
        'Services/PaymentService.cs': 'public class PaymentService {}',
      });
      const scan = scanRepo(dir);
      expect(scan.languages).toContain('csharp');
      expect(scan.domains.some(d => d.name === 'controllers')).toBe(true);
      expect(scan.domains.some(d => d.name === 'services')).toBe(true);
    });

    it('detects domains from Java, Swift, PHP, Elixir, Kotlin source files', () => {
      const dir = createFixture('multi-lang-project', {
        'services/UserService.java': 'public class UserService {}',
        'views/HomeView.swift': 'struct HomeView {}',
        'handlers/webhook.php': '<?php class Webhook {}',
        'workers/processor.ex': 'defmodule Processor do end',
        'ui/MainActivity.kt': 'class MainActivity {}',
      });
      const scan = scanRepo(dir);
      const names = scan.domains.map(d => d.name);
      expect(names).toContain('services');
      expect(names).toContain('views');
      expect(names).toContain('handlers');
      expect(names).toContain('workers');
      expect(names).toContain('ui');
    });

    it('skips bin, obj, and target build output directories', () => {
      const dir = createFixture('build-output-project', {
        'MyApp.csproj': '<Project></Project>',
        'bin/Debug/MyApp.cs': '// compiled artifact',
        'obj/project.assets.cs': '// intermediate',
        'target/classes/Foo.java': '// build output',
        'Services/Real.cs': 'public class Real {}',
      });
      const scan = scanRepo(dir);
      const names = scan.domains.map(d => d.name);
      expect(names).not.toContain('bin');
      expect(names).not.toContain('obj');
      expect(names).not.toContain('target');
      expect(names).toContain('services');
    });

    it('returns empty domains for featureless project', () => {
      const dir = createFixture('minimal-project', {
        'package.json': '{}',
        'src/index.ts': 'console.log("hello")',
      });
      const scan = scanRepo(dir);
      expect(scan.domains).toHaveLength(0);
    });
  });

  describe('repo type inference', () => {
    it('detects frontend', () => {
      const dir = createFixture('frontend-type', {
        'package.json': JSON.stringify({ dependencies: { react: '*' } }),
      });
      expect(scanRepo(dir).repoType).toBe('frontend');
    });

    it('detects backend', () => {
      const dir = createFixture('backend-type', {
        'requirements.txt': 'fastapi\n',
      });
      expect(scanRepo(dir).repoType).toBe('backend');
    });

    it('detects fullstack', () => {
      const dir = createFixture('fullstack-type', {
        'package.json': JSON.stringify({ dependencies: { react: '*', express: '*' } }),
      });
      expect(scanRepo(dir).repoType).toBe('fullstack');
    });

    it('detects monorepo', () => {
      const dir = createFixture('monorepo-type', {
        'package.json': '{}',
        'packages/a/package.json': '{}',
      });
      expect(scanRepo(dir).repoType).toBe('monorepo');
    });

    it('returns unknown for unrecognized', () => {
      const dir = createFixture('unknown-type', {
        'README.md': '# Hello',
      });
      expect(scanRepo(dir).repoType).toBe('unknown');
    });
  });

  describe('entry point detection', () => {
    it('finds src/index.ts', () => {
      const dir = createFixture('entry-ts', {
        'package.json': '{}',
        'src/index.ts': 'export {}',
      });
      expect(scanRepo(dir).entryPoints).toContain('src/index.ts');
    });

    it('finds app/main.py', () => {
      const dir = createFixture('entry-py', {
        'requirements.txt': '',
        'app/main.py': 'app = FastAPI()',
      });
      expect(scanRepo(dir).entryPoints).toContain('app/main.py');
    });
  });

  describe('repo size estimation', () => {
    it('counts source files and categorizes as small', () => {
      const dir = createFixture('size-small', {
        'package.json': '{}',
        'src/index.ts': 'console.log("hello")',
        'src/utils.ts': 'export const add = (a, b) => a + b',
      });
      const scan = scanRepo(dir);
      expect(scan.size).toBeDefined();
      expect(scan.size.sourceFiles).toBe(2);
      expect(scan.size.category).toBe('small');
    });

    it('skips node_modules and hidden dirs', () => {
      const dir = createFixture('size-skip', {
        'package.json': '{}',
        'src/app.js': 'const x = 1',
        'node_modules/dep/index.js': 'module.exports = {}',
        '.cache/temp.js': 'cached',
      });
      const scan = scanRepo(dir);
      expect(scan.size.sourceFiles).toBe(1);
    });

    it('estimates lines from file size', () => {
      const dir = createFixture('size-lines', {
        'package.json': '{}',
        'src/big.js': 'x'.repeat(400), // ~10 lines at 40 bytes/line
      });
      const scan = scanRepo(dir);
      expect(scan.size.estimatedLines).toBe(10);
    });
  });

  describe('claude config detection', () => {
    it('detects .claude directory', () => {
      const dir = createFixture('claude-config', {
        'package.json': '{}',
        '.claude/skills/base/skill.md': '---\nname: base\n---',
      });
      expect(scanRepo(dir).hasClaudeConfig).toBe(true);
    });

    it('detects CLAUDE.md', () => {
      const dir = createFixture('claude-md', {
        'package.json': '{}',
        'CLAUDE.md': '# My Project',
      });
      expect(scanRepo(dir).hasClaudeMd).toBe(true);
    });
  });
});
