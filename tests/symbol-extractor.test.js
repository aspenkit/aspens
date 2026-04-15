import { describe, it, expect } from 'vitest';
import {
  extractDefinitions,
  stripForScanning,
  buildIntraDirectoryEdges,
  INTRA_DIR_EXTS,
} from '../src/lib/symbol-extractor.js';

// ---------------------------------------------------------------------------
// 1. Go definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — Go', () => {
  it('extracts function definitions', () => {
    const content = stripForScanning(`
func NewRuntime() *Runtime {
}
func parseModule(data []byte) (*Module, error) {
}`, '.go');
    const defs = extractDefinitions(content, '.go');
    expect(defs).toContainEqual({ name: 'NewRuntime', type: 'function' });
    expect(defs).toContainEqual({ name: 'parseModule', type: 'function' });
  });

  it('extracts method definitions', () => {
    const content = stripForScanning(`
func (r *Runtime) InstantiateModule(reader io.Reader) (*ModuleInstance, error) {
}
func (v *VM) executeFunction(fn *Function) error {
}`, '.go');
    const defs = extractDefinitions(content, '.go');
    expect(defs).toContainEqual({ name: 'InstantiateModule', type: 'method' });
    expect(defs).toContainEqual({ name: 'executeFunction', type: 'method' });
  });

  it('extracts type definitions', () => {
    const content = stripForScanning(`
type Runtime struct {
  config Config
}
type ValueType byte
type ModuleImport interface {
  Name() string
}`, '.go');
    const defs = extractDefinitions(content, '.go');
    expect(defs).toContainEqual({ name: 'Runtime', type: 'type' });
    expect(defs).toContainEqual({ name: 'ValueType', type: 'type' });
    expect(defs).toContainEqual({ name: 'ModuleImport', type: 'type' });
  });

  it('extracts const and var declarations', () => {
    const content = stripForScanning(`
const MaxMemoryPages = 65536
var DefaultConfig = Config{}`, '.go');
    const defs = extractDefinitions(content, '.go');
    expect(defs).toContainEqual({ name: 'MaxMemoryPages', type: 'var' });
    expect(defs).toContainEqual({ name: 'DefaultConfig', type: 'var' });
  });

  it('extracts names from const/var blocks', () => {
    const content = stripForScanning(`
const (
  OpUnreachable byte = 0x00
  OpNop         byte = 0x01
  OpBlock       byte = 0x02
)`, '.go');
    const defs = extractDefinitions(content, '.go');
    const names = defs.map(d => d.name);
    expect(names).toContain('OpUnreachable');
    expect(names).toContain('OpNop');
    expect(names).toContain('OpBlock');
  });

  it('ignores definitions in comments', () => {
    const content = stripForScanning(`
// func OldFunction() {}
func ActiveFunction() {}`, '.go');
    const defs = extractDefinitions(content, '.go');
    const names = defs.map(d => d.name);
    expect(names).toContain('ActiveFunction');
    expect(names).not.toContain('OldFunction');
  });
});

// ---------------------------------------------------------------------------
// 2. Python definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — Python', () => {
  it('extracts functions and classes', () => {
    const content = stripForScanning(`
def scan_repo(path):
    pass

class Scanner:
    pass`, '.py');
    const defs = extractDefinitions(content, '.py');
    expect(defs).toContainEqual({ name: 'scan_repo', type: 'function' });
    expect(defs).toContainEqual({ name: 'Scanner', type: 'class' });
  });
});

// ---------------------------------------------------------------------------
// 3. Java definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — Java', () => {
  it('extracts classes and interfaces', () => {
    const content = stripForScanning(`
public class UserService {
}
interface UserRepository {
}`, '.java');
    const defs = extractDefinitions(content, '.java');
    expect(defs).toContainEqual({ name: 'UserService', type: 'class' });
    expect(defs).toContainEqual({ name: 'UserRepository', type: 'class' });
  });
});

// ---------------------------------------------------------------------------
// 4. Rust definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — Rust', () => {
  it('extracts functions and types', () => {
    const content = stripForScanning(`
pub fn parse_module(data: &[u8]) -> Result<Module> {
}
struct Module {
}
enum ValueType {
}`, '.rs');
    const defs = extractDefinitions(content, '.rs');
    expect(defs).toContainEqual({ name: 'parse_module', type: 'function' });
    expect(defs).toContainEqual({ name: 'Module', type: 'type' });
    expect(defs).toContainEqual({ name: 'ValueType', type: 'type' });
  });
});

// ---------------------------------------------------------------------------
// 5. C# definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — C#', () => {
  it('extracts classes and interfaces', () => {
    const content = stripForScanning(`
public class UserController {
}
interface IUserService {
}`, '.cs');
    const defs = extractDefinitions(content, '.cs');
    expect(defs).toContainEqual({ name: 'UserController', type: 'class' });
    expect(defs).toContainEqual({ name: 'IUserService', type: 'class' });
  });
});

// ---------------------------------------------------------------------------
// 6. Swift definition extraction
// ---------------------------------------------------------------------------
describe('extractDefinitions — Swift', () => {
  it('extracts functions and types', () => {
    const content = stripForScanning(`
func loadData() {
}
class ViewModel {
}
struct User {
}
protocol Loadable {
}`, '.swift');
    const defs = extractDefinitions(content, '.swift');
    expect(defs).toContainEqual({ name: 'loadData', type: 'function' });
    expect(defs).toContainEqual({ name: 'ViewModel', type: 'class' });
    expect(defs).toContainEqual({ name: 'User', type: 'class' });
    expect(defs).toContainEqual({ name: 'Loadable', type: 'class' });
  });
});

// ---------------------------------------------------------------------------
// 7. Comment/string stripping
// ---------------------------------------------------------------------------
describe('stripForScanning', () => {
  it('strips Go block comments', () => {
    const result = stripForScanning('/* comment */ func Real() {}', '.go');
    expect(result).not.toContain('comment');
    expect(result).toContain('Real');
  });

  it('strips Go line comments', () => {
    const result = stripForScanning('// comment\nfunc Real() {}', '.go');
    expect(result).not.toContain('comment');
    expect(result).toContain('Real');
  });

  it('strips Go string literals', () => {
    const result = stripForScanning('var x = "Config is important"', '.go');
    expect(result).not.toContain('important');
  });

  it('strips Python docstrings', () => {
    const result = stripForScanning('"""Config docs"""\ndef real():', '.py');
    expect(result).not.toContain('docs');
    expect(result).toContain('real');
  });
});

// ---------------------------------------------------------------------------
// 8. Intra-directory edge building
// ---------------------------------------------------------------------------
describe('buildIntraDirectoryEdges', () => {
  it('creates edges between Go files in the same package', () => {
    const files = {
      'epsilon/config.go': {
        definitions: [
          { name: 'Config', type: 'type' },
          { name: 'NewRuntime', type: 'function' },
        ],
        strippedContent: 'type Config struct { }\nfunc NewRuntime() *Runtime { }',
        ext: '.go',
      },
      'epsilon/vm.go': {
        definitions: [
          { name: 'executeFunction', type: 'function' },
        ],
        strippedContent: 'func executeFunction(cfg Config) {\n  r := NewRuntime()\n}',
        ext: '.go',
      },
      'epsilon/parser.go': {
        definitions: [
          { name: 'parseModule', type: 'function' },
        ],
        strippedContent: 'func parseModule(cfg Config) { }',
        ext: '.go',
      },
    };

    const edges = buildIntraDirectoryEdges(files);

    // vm.go references Config (from config.go) and NewRuntime (from config.go)
    expect(edges).toContainEqual({ from: 'epsilon/vm.go', to: 'epsilon/config.go' });
    // parser.go references Config (from config.go)
    expect(edges).toContainEqual({ from: 'epsilon/parser.go', to: 'epsilon/config.go' });
  });

  it('does not create self-edges', () => {
    const files = {
      'pkg/main.go': {
        definitions: [{ name: 'Run', type: 'function' }],
        strippedContent: 'func Run() { Run() }',
        ext: '.go',
      },
    };

    const edges = buildIntraDirectoryEdges(files);
    expect(edges).toHaveLength(0);
  });

  it('does not create edges for JS files (explicit imports required)', () => {
    const files = {
      'src/a.js': {
        definitions: [{ name: 'helper', type: 'function' }],
        strippedContent: 'function helper() {}',
        ext: '.js',
      },
      'src/b.js': {
        definitions: [{ name: 'main', type: 'function' }],
        strippedContent: 'function main() { helper() }',
        ext: '.js',
      },
    };

    const edges = buildIntraDirectoryEdges(files);
    expect(edges).toHaveLength(0); // JS not in INTRA_DIR_EXTS
  });

  it('skips Go builtins', () => {
    const files = {
      'pkg/a.go': {
        definitions: [{ name: 'error', type: 'type' }],
        strippedContent: 'type error interface { Error() string }',
        ext: '.go',
      },
      'pkg/b.go': {
        definitions: [{ name: 'handle', type: 'function' }],
        strippedContent: 'func handle() error { return nil }',
        ext: '.go',
      },
    };

    const edges = buildIntraDirectoryEdges(files);
    // 'error' is a Go builtin — should be skipped
    expect(edges).toHaveLength(0);
  });

  it('deduplicates edges between the same file pair', () => {
    const files = {
      'pkg/types.go': {
        definitions: [
          { name: 'Config', type: 'type' },
          { name: 'Runtime', type: 'type' },
        ],
        strippedContent: 'type Config struct {}\ntype Runtime struct {}',
        ext: '.go',
      },
      'pkg/vm.go': {
        definitions: [{ name: 'run', type: 'function' }],
        strippedContent: 'func run(c Config, r Runtime) {}',
        ext: '.go',
      },
    };

    const edges = buildIntraDirectoryEdges(files);
    // vm.go → types.go should appear only once despite matching both Config and Runtime
    const vmToTypes = edges.filter(e => e.from === 'pkg/vm.go' && e.to === 'pkg/types.go');
    expect(vmToTypes).toHaveLength(1);
  });

  it('handles Java files in same package', () => {
    const files = {
      'src/models/User.java': {
        definitions: [{ name: 'User', type: 'class' }],
        strippedContent: 'public class User { }',
        ext: '.java',
      },
      'src/models/UserService.java': {
        definitions: [{ name: 'UserService', type: 'class' }],
        strippedContent: 'public class UserService {\n  User user;\n}',
        ext: '.java',
      },
    };

    const edges = buildIntraDirectoryEdges(files);
    expect(edges).toContainEqual({ from: 'src/models/UserService.java', to: 'src/models/User.java' });
  });
});
