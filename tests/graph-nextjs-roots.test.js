import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectNextjsEntryPoints, isNextjsProject, nextjsImplicitAliases } from '../src/lib/frameworks/nextjs.js';

describe('frameworks/nextjs', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aspens-nextjs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('isNextjsProject', () => {
    it('detects via scan.frameworks containing "nextjs"', () => {
      expect(isNextjsProject({ frameworks: ['nextjs'] })).toBe(true);
    });

    it('detects via dependencies.next', () => {
      expect(isNextjsProject({ frameworks: [], dependencies: { next: '^14.0.0' } })).toBe(true);
    });

    it('returns false for non-Next.js scans', () => {
      expect(isNextjsProject({ frameworks: ['vite'], dependencies: {} })).toBe(false);
      expect(isNextjsProject({})).toBe(false);
      expect(isNextjsProject(null)).toBe(false);
    });
  });

  describe('detectNextjsEntryPoints', () => {
    it('detects App Router files (page, layout, route)', () => {
      mkdirSync(join(dir, 'app', 'about'), { recursive: true });
      writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function Home(){}\n');
      writeFileSync(join(dir, 'app', 'layout.tsx'), 'export default function Layout(){}\n');
      writeFileSync(join(dir, 'app', 'about', 'page.tsx'), 'export default function About(){}\n');
      mkdirSync(join(dir, 'app', 'api', 'users'), { recursive: true });
      writeFileSync(join(dir, 'app', 'api', 'users', 'route.ts'), 'export function GET(){}\n');

      const entries = detectNextjsEntryPoints(dir);
      const paths = entries.map(e => e.path).sort();
      expect(paths).toContain('app/page.tsx');
      expect(paths).toContain('app/layout.tsx');
      expect(paths).toContain('app/about/page.tsx');
      expect(paths).toContain('app/api/users/route.ts');
      for (const e of entries) {
        if (e.path.startsWith('app/')) expect(e.kind).toBe('nextjs-app');
      }
    });

    it('detects special files like middleware.ts and instrumentation.ts', () => {
      writeFileSync(join(dir, 'middleware.ts'), 'export function middleware(){}\n');
      writeFileSync(join(dir, 'instrumentation.ts'), 'export function register(){}\n');

      const entries = detectNextjsEntryPoints(dir);
      const paths = entries.map(e => e.path).sort();
      expect(paths).toContain('middleware.ts');
      expect(paths).toContain('instrumentation.ts');
      const middleware = entries.find(e => e.path === 'middleware.ts');
      expect(middleware.kind).toBe('nextjs-middleware');
    });

    it('detects metadata route files (sitemap.ts, robots.ts)', () => {
      mkdirSync(join(dir, 'app'), { recursive: true });
      writeFileSync(join(dir, 'app', 'sitemap.ts'), 'export default function sitemap(){}\n');
      writeFileSync(join(dir, 'app', 'robots.ts'), 'export default function robots(){}\n');

      const entries = detectNextjsEntryPoints(dir);
      const paths = entries.map(e => e.path);
      expect(paths).toContain('app/sitemap.ts');
      expect(paths).toContain('app/robots.ts');
    });

    it('detects Pages Router files alongside App Router', () => {
      mkdirSync(join(dir, 'pages', 'api'), { recursive: true });
      mkdirSync(join(dir, 'app'), { recursive: true });
      writeFileSync(join(dir, 'pages', 'index.tsx'), 'export default function(){}\n');
      writeFileSync(join(dir, 'pages', 'api', 'hello.ts'), 'export default function(){}\n');
      writeFileSync(join(dir, 'app', 'page.tsx'), 'export default function(){}\n');

      const entries = detectNextjsEntryPoints(dir);
      const pagesEntries = entries.filter(e => e.kind === 'nextjs-pages');
      expect(pagesEntries.length).toBeGreaterThanOrEqual(2);
      expect(pagesEntries.some(e => e.path === 'pages/index.tsx')).toBe(true);
      expect(pagesEntries.some(e => e.path === 'pages/api/hello.ts')).toBe(true);
    });

    it('skips non-code-bearing extensions for metadata routes', () => {
      mkdirSync(join(dir, 'app'), { recursive: true });
      writeFileSync(join(dir, 'app', 'icon.png'), 'binary');
      writeFileSync(join(dir, 'app', 'icon.ts'), 'export default function(){}\n');

      const entries = detectNextjsEntryPoints(dir);
      const paths = entries.map(e => e.path);
      expect(paths).toContain('app/icon.ts');
      expect(paths).not.toContain('app/icon.png');
    });

    it('returns empty array for non-Next.js repos', () => {
      writeFileSync(join(dir, 'index.js'), 'console.log("plain")');
      expect(detectNextjsEntryPoints(dir)).toEqual([]);
    });
  });

  describe('nextjsImplicitAliases', () => {
    it('points @/ at src/ when present', () => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const aliases = nextjsImplicitAliases(dir);
      expect(aliases).toEqual([{ prefix: '@/', replacement: join(dir, 'src') }]);
    });

    it('points @/ at the repo root when src/ is missing', () => {
      const aliases = nextjsImplicitAliases(dir);
      expect(aliases).toEqual([{ prefix: '@/', replacement: dir }]);
    });
  });
});
