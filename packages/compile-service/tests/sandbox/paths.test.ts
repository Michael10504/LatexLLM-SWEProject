import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertBuildPath, containerName, normalizeForDocker, resolveProjectDir } from '../../src/sandbox/paths';
import { ProjectInvalidError } from '../../src/sandbox/errors';

describe('normalizeForDocker', () => {
  it('converts Windows backslashes and keeps the drive letter and spaces', () => {
    expect(normalizeForDocker('D:\\LatexLLM SWE\\proj', 'win32')).toBe('D:/LatexLLM SWE/proj');
  });
  it('strips a trailing separator but keeps a bare drive root', () => {
    expect(normalizeForDocker('D:\\proj\\', 'win32')).toBe('D:/proj');
    expect(normalizeForDocker('D:\\', 'win32')).toBe('D:/');
  });
  it('rejects UNC and WSL paths', () => {
    expect(() => normalizeForDocker('\\\\wsl$\\Ubuntu\\home', 'win32')).toThrow(ProjectInvalidError);
    expect(() => normalizeForDocker('\\\\server\\share', 'win32')).toThrow(ProjectInvalidError);
  });
  it('rejects relative paths and extra colons', () => {
    expect(() => normalizeForDocker('proj', 'win32')).toThrow(ProjectInvalidError);
    expect(() => normalizeForDocker('D:\\a:b', 'win32')).toThrow(ProjectInvalidError);
    expect(() => normalizeForDocker('/a:b', 'linux')).toThrow(ProjectInvalidError);
  });
  it('leaves POSIX paths alone', () => {
    expect(normalizeForDocker('/home/s/proj/', 'linux')).toBe('/home/s/proj');
  });
});

describe('containerName', () => {
  it('is stable, lowercase and docker-safe', () => {
    const a = containerName('My Proj!');
    expect(a).toBe(containerName('My Proj!'));
    expect(a).toMatch(/^ltx-[a-z0-9_.-]+-[0-9a-f]{8}$/);
  });
  it('does not collide when sanitizing maps two ids to the same text', () => {
    expect(containerName('My Proj!')).not.toBe(containerName('my-proj-'));
  });
  it('caps the readable part', () => {
    expect(containerName('x'.repeat(200)).length).toBeLessThanOrEqual(4 + 40 + 1 + 8);
  });
});

describe('resolveProjectDir (C10)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // Real filesystem paths, so use the real OS rules (Windows: D:\\x → D:/x).
  const expected = (dir: string) => normalizeForDocker(fs.realpathSync.native(dir), process.platform);

  it('throws when main.tex is missing', () => {
    expect(() => resolveProjectDir(tmp)).toThrow(/main\.tex not found/);
  });
  it('throws when the folder does not exist', () => {
    expect(() => resolveProjectDir(path.join(tmp, 'nope'))).toThrow(/not found/);
  });
  it('returns the docker-ready path when main.tex exists', () => {
    fs.writeFileSync(path.join(tmp, 'main.tex'), '\\documentclass{article}');
    const out = resolveProjectDir(tmp);
    expect(out).toBe(expected(tmp));
    expect(out).not.toContain('\\');
  });
  it('works on the real basic fixture', () => {
    const dir = path.join(__dirname, '../../fixtures/basic');
    expect(resolveProjectDir(dir)).toBe(expected(dir));
  });
});

describe('assertBuildPath', () => {
  it('allows files under /build', () => {
    expect(() => assertBuildPath('/build/main.pdf')).not.toThrow();
    expect(() => assertBuildPath('/build/chapters/intro.aux')).not.toThrow();
  });
  it('blocks traversal and other folders', () => {
    expect(() => assertBuildPath('/build/../etc/passwd')).toThrow(ProjectInvalidError);
    expect(() => assertBuildPath('/work/main.tex')).toThrow(ProjectInvalidError);
    expect(() => assertBuildPath('/build/a;rm -rf /')).toThrow(ProjectInvalidError);
  });
});
