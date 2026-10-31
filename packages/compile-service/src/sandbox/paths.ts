import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectInvalidError } from './errors';

/**
 * Pure: turn an absolute host path into the form Docker Desktop accepts in `-v`.
 * Windows: D:\a b\proj → D:/a b/proj. Testable on any OS by passing the platform.
 */
export function normalizeForDocker(absPath: string, platform: NodeJS.Platform): string {
  if (absPath.startsWith('\\\\') || absPath.startsWith('//')) {
    throw new ProjectInvalidError('Network and WSL (\\\\...) paths are not supported. Move the project to a local drive.');
  }
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(absPath)) throw new ProjectInvalidError(`Not an absolute Windows path: ${absPath}`);
    const p = absPath.replace(/\\/g, '/');
    // Only the drive colon may contain ':' — anything else would break -v parsing.
    if (p.indexOf(':', 2) !== -1) throw new ProjectInvalidError(`Path contains ':' : ${absPath}`);
    return p.length > 3 ? p.replace(/\/+$/, '') : p;
  }
  if (!absPath.startsWith('/')) throw new ProjectInvalidError(`Not an absolute path: ${absPath}`);
  if (absPath.includes(':')) throw new ProjectInvalidError(`Path contains ':' : ${absPath}`);
  return absPath.length > 1 ? absPath.replace(/\/+$/, '') : absPath;
}

/**
 * Resolve, validate and convert a project folder for mounting.
 * C10: main.tex must exist BEFORE any container starts — a wrong path would mount an empty folder.
 */
export function resolveProjectDir(dir: string, platform: NodeJS.Platform = process.platform): string {
  let abs: string;
  try {
    abs = fs.realpathSync.native(path.resolve(dir));
  } catch {
    throw new ProjectInvalidError(`Project folder not found: ${dir}`);
  }
  if (!fs.statSync(abs).isDirectory()) throw new ProjectInvalidError(`Not a folder: ${abs}`);
  const main = path.join(abs, 'main.tex');
  if (!fs.existsSync(main) || !fs.statSync(main).isFile()) {
    throw new ProjectInvalidError('main.tex not found in the project root.');
  }
  return normalizeForDocker(abs, platform);
}

/** ltx-<sanitized id>-<8 hex>. Docker names allow [a-zA-Z0-9][a-zA-Z0-9_.-]; the hash avoids collisions after sanitizing. */
export function containerName(projectId: string): string {
  if (!projectId) throw new ProjectInvalidError('Empty project id');
  const safe = projectId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 40);
  const hash = createHash('sha1').update(projectId).digest('hex').slice(0, 8);
  return `ltx-${safe}-${hash}`;
}

/** Only files under /build may be copied out; no traversal. */
export function assertBuildPath(containerPath: string): void {
  if (!/^\/build\/[\w./-]+$/.test(containerPath) || containerPath.split('/').includes('..')) {
    throw new ProjectInvalidError(`Refusing to copy out ${containerPath}: only files under /build are allowed.`);
  }
}
