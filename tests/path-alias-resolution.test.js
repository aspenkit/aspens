import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildRepoGraph } from '../src/lib/graph-builder.js';

describe('path alias resolution', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aspens-aliases-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves "@/lib/foo" via tsconfig paths', async () => {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'foo.ts'), 'export const foo = 1;\n');
    writeFileSync(join(dir, 'index.ts'), "import { foo } from '@/lib/foo';\nexport const x = foo;\n");
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } }
    }, null, 2));

    const graph = await buildRepoGraph(dir);
    expect(graph.files['index.ts'].imports).toContain('lib/foo.ts');
  });

  it('follows tsconfig `extends` chains (single level)', async () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const foo = 1;\n');
    writeFileSync(join(dir, 'src', 'index.ts'), "import { foo } from '@/foo';\nexport const x = foo;\n");
    writeFileSync(join(dir, 'tsconfig.base.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } }
    }, null, 2));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: {}
    }, null, 2));

    const graph = await buildRepoGraph(dir);
    expect(graph.files['src/index.ts'].imports).toContain('src/foo.ts');
  });

  it('child config overrides parent paths', async () => {
    mkdirSync(join(dir, 'a'), { recursive: true });
    mkdirSync(join(dir, 'b'), { recursive: true });
    writeFileSync(join(dir, 'a', 'thing.ts'), 'export const thing = 1;\n');
    writeFileSync(join(dir, 'b', 'thing.ts'), 'export const thing = 2;\n');
    writeFileSync(join(dir, 'index.ts'), "import { thing } from '@/thing';\nexport const x = thing;\n");
    writeFileSync(join(dir, 'tsconfig.base.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./a/*'] } }
    }, null, 2));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./b/*'] } }
    }, null, 2));

    const graph = await buildRepoGraph(dir);
    expect(graph.files['index.ts'].imports).toContain('b/thing.ts');
  });

  it('falls back to the implicit Next.js @/ alias when tsconfig has no paths', async () => {
    mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'src', 'lib', 'foo.ts'), 'export const foo = 1;\n');
    writeFileSync(join(dir, 'src', 'index.ts'), "import { foo } from '@/lib/foo';\n");
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }, null, 2));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'demo', dependencies: { next: '^14.0.0' }
    }, null, 2));

    const graph = await buildRepoGraph(dir);
    expect(graph.files['src/index.ts'].imports).toContain('src/lib/foo.ts');
  });
});
