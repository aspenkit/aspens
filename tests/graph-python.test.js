import { describe, it, expect } from 'vitest';
import { extractPythonExports, parsePyImports } from '../src/lib/parsers/python.js';

describe('parsers/python', () => {
  describe('extractPythonExports', () => {
    it('captures top-level def names', () => {
      const src = [
        'def foo():',
        '    pass',
        '',
        'def bar(a, b):',
        '    return a + b',
      ].join('\n');
      expect(extractPythonExports(src).sort()).toEqual(['bar', 'foo']);
    });

    it('captures async def names', () => {
      const src = 'async def fetch():\n    pass\n';
      expect(extractPythonExports(src)).toEqual(['fetch']);
    });

    it('captures top-level class names', () => {
      const src = 'class Cache:\n    pass\n\nclass Service(Cache):\n    pass\n';
      expect(extractPythonExports(src).sort()).toEqual(['Cache', 'Service']);
    });

    it('rejects nested defs (methods inside a class)', () => {
      const src = [
        'class Foo:',
        '    def method(self):',
        '        pass',
        '',
        'def top_level():',
        '    pass',
      ].join('\n');
      const out = extractPythonExports(src).sort();
      expect(out).toContain('Foo');
      expect(out).toContain('top_level');
      expect(out).not.toContain('method');
    });

    it('ignores defs inside docstrings', () => {
      const src = '"""\ndef inside_doc():\n    pass\n"""\n\ndef real_def():\n    pass\n';
      expect(extractPythonExports(src)).toEqual(['real_def']);
    });

    it('does NOT extract SCREAMING_SNAKE constants (intentional drop)', () => {
      const src = 'API_URL = "https://example.com"\n\ndef foo():\n    pass\n';
      expect(extractPythonExports(src)).toEqual(['foo']);
    });

    it('returns empty for empty content', () => {
      expect(extractPythonExports('')).toEqual([]);
    });

    it('dedupes (same name twice)', () => {
      const src = 'def foo():\n    pass\n\ndef foo():\n    pass\n';
      expect(extractPythonExports(src)).toEqual(['foo']);
    });
  });

  describe('parsePyImports', () => {
    it('captures `from x import y` form', () => {
      const src = 'from app.services import db\nfrom .helpers import bar\n';
      expect(parsePyImports(src)).toEqual(['app.services', '.helpers']);
    });

    it('captures `import x` form', () => {
      const src = 'import os\nimport app.config\n';
      expect(parsePyImports(src)).toEqual(['os', 'app.config']);
    });

    it('ignores imports inside docstrings', () => {
      const src = '"""\nimport this_is_in_a_docstring\n"""\nimport real\n';
      expect(parsePyImports(src)).toEqual(['real']);
    });
  });
});
