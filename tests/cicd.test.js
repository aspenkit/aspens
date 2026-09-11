import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, resolve } from 'path';

// The behaviour under test is a filesystem refusal, which cannot be staged
// portably with real files — Windows ACLs and POSIX modes disagree, and CI
// often runs as root, where a mode of 000 is still readable.
const fsState = { dirs: new Set(), files: new Set(), unreadable: new Set(), entries: new Map() };

vi.mock('fs', () => ({
  readdirSync: (path) => {
    const key = String(path);
    if (fsState.unreadable.has(key)) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    if (fsState.files.has(key)) throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
    if (!fsState.dirs.has(key)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return fsState.entries.get(key) || [];
  },
  statSync: (path) => {
    const key = String(path);
    const isDirectory = fsState.dirs.has(key);
    const isFile = fsState.files.has(key);
    if (!isDirectory && !isFile) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isDirectory: () => isDirectory, isFile: () => isFile };
  },
}));

const { detectCICD } = await import('../src/lib/cicd.js');

const ROOT = resolve('/repo');

function dir(relative, entries = []) {
  const full = relative ? join(ROOT, relative) : ROOT;
  fsState.dirs.add(full);
  fsState.entries.set(full, entries);
  return full;
}

describe('CI/CD detection when the filesystem refuses', () => {
  beforeEach(() => {
    fsState.dirs.clear();
    fsState.files.clear();
    fsState.unreadable.clear();
    fsState.entries.clear();
    dir('');
  });

  it('credits a platform whose config directory cannot be read', () => {
    fsState.unreadable.add(dir('.circleci'));
    // Unknown, not empty — dropping it would hide a configured platform.
    expect(detectCICD(ROOT)).toEqual(['circleci']);
  });

  it('credits a platform when a nested directory cannot be read', () => {
    dir('.buildkite', ['pipelines']);
    fsState.unreadable.add(dir('.buildkite/pipelines'));
    expect(detectCICD(ROOT)).toEqual(['buildkite']);
  });

  it('ignores a config directory that is readable and empty', () => {
    dir('.circleci', []);
    expect(detectCICD(ROOT)).toEqual([]);
  });

  it('ignores a config directory that is readable and holds no CI config', () => {
    dir('.circleci', ['README.md']);
    fsState.files.add(join(ROOT, '.circleci', 'README.md'));
    expect(detectCICD(ROOT)).toEqual([]);
  });

  it('ignores a marker directory name that is really a file', () => {
    fsState.files.add(join(ROOT, '.circleci'));
    expect(detectCICD(ROOT)).toEqual([]);
  });

  it('ignores a config directory that does not exist', () => {
    expect(detectCICD(ROOT)).toEqual([]);
  });
});
