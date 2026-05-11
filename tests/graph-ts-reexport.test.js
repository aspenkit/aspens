import { describe, it, expect } from 'vitest';
import { parseJsImports } from '../src/lib/parsers/typescript.js';

describe('parsers/typescript', () => {
  describe('default exports', () => {
    it('resolves `export default function Foo`', async () => {
      const src = 'export default function Foo() { return 1; }';
      const { exports } = await parseJsImports(src, 'test.ts');
      expect(exports).toContain('Foo');
      expect(exports).not.toContain('default');
    });

    it('resolves `export default class Bar`', async () => {
      const src = 'export default class Bar {}';
      const { exports } = await parseJsImports(src, 'test.ts');
      expect(exports).toContain('Bar');
    });

    it('resolves `export default async function fetch`', async () => {
      const src = 'export default async function fetch() {}';
      const { exports } = await parseJsImports(src, 'test.ts');
      expect(exports).toContain('fetch');
    });

    it('resolves the reassignment pattern `const Foo = ...; export default Foo`', async () => {
      const src = 'const Foo = () => 1;\nexport default Foo;\n';
      const { exports } = await parseJsImports(src, 'test.ts');
      expect(exports).toContain('Foo');
    });

    it('falls back to `default` when no resolvable name is found', async () => {
      const src = 'export default { foo: 1 };';
      const { exports } = await parseJsImports(src, 'test.ts');
      // No identifier resolvable for an object literal — keep `default`.
      expect(exports).toContain('default');
    });
  });

  describe('export * from re-exports', () => {
    it('emits a synthetic re-export marker and an import edge', async () => {
      const src = "export * from './foo';\n";
      const { imports, exports } = await parseJsImports(src, 'index.ts');
      expect(imports).toContain('./foo');
      expect(exports).toContain('re-export:./foo');
    });

    it('handles named re-export-as form', async () => {
      const src = "export * as helpers from './helpers';\n";
      const { imports, exports } = await parseJsImports(src, 'index.ts');
      expect(imports).toContain('./helpers');
      expect(exports).toContain('re-export:./helpers');
    });

    it('handles multiple `export * from` lines', async () => {
      const src = "export * from './a';\nexport * from './b';\nexport * from './c';\n";
      const { imports, exports } = await parseJsImports(src, 'index.ts');
      expect(imports.sort()).toEqual(['./a', './b', './c']);
      expect(exports).toContain('re-export:./a');
      expect(exports).toContain('re-export:./b');
      expect(exports).toContain('re-export:./c');
    });
  });

  describe('regular exports', () => {
    it('captures named exports', async () => {
      const src = 'export const foo = 1;\nexport function bar() {}\nexport class Baz {}';
      const { exports } = await parseJsImports(src, 'test.ts');
      expect(exports).toContain('foo');
      expect(exports).toContain('bar');
      expect(exports).toContain('Baz');
    });

    it('captures imports', async () => {
      const src = "import { foo } from './foo';\nimport bar from 'bar';\n";
      const { imports } = await parseJsImports(src, 'test.ts');
      expect(imports).toContain('./foo');
      expect(imports).toContain('bar');
    });
  });
});
