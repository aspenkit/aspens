import { relative } from 'path';

export function toPosix(filePath) {
  return typeof filePath === 'string' ? filePath.split('\\').join('/') : filePath;
}

export function relativePosix(from, to) {
  return toPosix(relative(from, to));
}

export function toPosixRelative(from, to) {
  const rel = relativePosix(from, to);
  return !rel || rel === '.' ? '' : rel;
}
