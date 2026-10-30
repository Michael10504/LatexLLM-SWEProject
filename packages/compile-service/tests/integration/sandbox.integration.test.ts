/**
 * Step 12: the sandbox against REAL Docker (Docker Desktop running, image ltx-sandbox:1 built).
 *   npm run test:docker
 * Each test prints nothing on success; ids map to the test table for Member 5 (IT-01 … IT-12).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DockerCompileService } from '../../src/compile/DockerCompileService';
import { checkRunningContainer } from '../../src/sandbox/inspectChecklist';
import { SandboxRunner, texAlive } from '../../src/sandbox/SandboxRunner';

const FIX = path.resolve(__dirname, '../../fixtures');
const quiet = { warn: () => {}, debug: () => {} };
const runner = new SandboxRunner(undefined, { logger: quiet });
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-it-'));
const svc = new DockerCompileService({ cacheDir: cache, sandbox: runner, logger: quiet });
const shortSvc = new DockerCompileService({ cacheDir: cache, sandbox: runner, timeoutMs: 10_000, logger: quiet });
const ids: string[] = [];
const proj = (id: string, dir: string) => {
  const p = { id: `it-${id}`, rootDir: path.join(FIX, dir) };
  ids.push(p.id);
  return p;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noTex = async (name: string) => !texAlive((await runner.exec(name, ['ps', '-eo', 'stat=,comm='])).stdout.toString());

beforeAll(async () => {
  await runner.cleanupOrphans();
});
afterAll(async () => {
  for (const id of ids) await runner.stop(id);
  fs.rmSync(cache, { recursive: true, force: true });
});

describe('Step 12: sandbox on real Docker', () => {
  const basic = proj('basic', 'basic');

  it('IT-01 success: basic project → SUCCESS, valid PDF, no errors', async () => {
    const r = await svc.compile(basic);
    expect(r.status).toBe('SUCCESS');
    expect(fs.readFileSync(r.pdfPath!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.log.filter((e) => e.level === 'ERROR')).toEqual([]);
  });

  it('IT-02 subfolders are mirrored into /build (C8)', async () => {
    const name = runner.containerName(basic.id);
    expect((await runner.exec(name, ['test', '-d', '/build/chapters'])).code).toBe(0);
  });

  it('IT-03 error: FAILED with a clickable main.tex:5', async () => {
    const r = await svc.compile(proj('error', 'error'));
    expect(r.status).toBe('FAILED');
    expect(r.log).toContainEqual({ level: 'ERROR', file: 'main.tex', line: 5, message: 'Undefined control sequence.' });
  });

  it('IT-04 failed build keeps the last good PDF (demo flow 3)', async () => {
    const r = await svc.compile({ id: basic.id, rootDir: path.join(FIX, 'error') });
    expect(r.status).toBe('FAILED');
    expect(r.pdfPath).toBe(svc.lastGoodPath(basic.id));
    await svc.compile(basic); // back to the real folder for later tests
  });

  it('IT-05 timeout: infinite loop → TIMEOUT and no TeX left running (demo flow 4)', async () => {
    const loop = proj('loop', 'infinite-loop');
    const t0 = Date.now();
    const r = await shortSvc.compile(loop);
    expect(r.status).toBe('TIMEOUT');
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(await noTex(runner.containerName(loop.id))).toBe(true);
  });

  it('IT-06 a second compile cancels the first; cancel() stops a run (demo flow 5)', async () => {
    const loop = proj('loop2', 'infinite-loop');
    const first = shortSvc.compile(loop);
    await wait(3000);
    const second = shortSvc.compile(loop);
    await wait(2000);
    await shortSvc.cancel(loop.id);
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe('CANCELLED');
    expect(b.status).toBe('CANCELLED');
    expect(await noTex(runner.containerName(loop.id))).toBe(true);
  });

  it('IT-07 shell escape is blocked (demo flow 6)', async () => {
    const se = proj('shell', 'shell-escape');
    await svc.compile(se);
    const name = runner.containerName(se.id);
    const log = (await runner.readLog(name))?.toString('utf8') ?? '';
    expect(log).toMatch(/runsystem\(touch \/tmp\/pwned\)\.\.\.disabled/);
    expect((await runner.exec(name, ['test', '-e', '/tmp/pwned'])).code).not.toBe(0);
  });

  it('IT-08 the project folder is read-only inside the sandbox (demo flow 6)', async () => {
    const r = await runner.exec(runner.containerName(basic.id), ['touch', '/work/hack.txt']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/Read-only file system/);
    expect(fs.existsSync(path.join(FIX, 'basic', 'hack.txt'))).toBe(false);
  });

  it('IT-09 no network inside the sandbox', async () => {
    const r = await runner.exec(runner.containerName(basic.id), ['ls', '/sys/class/net']);
    expect(r.stdout.toString().trim()).toBe('lo');
  });

  it('IT-10 /build is capped at 500 MB (disk full is contained)', async () => {
    const name = runner.containerName(basic.id);
    const r = await runner.exec(name, ['sh', '-c', 'head -c 600M /dev/zero > /build/fill.bin'], { timeoutMs: 120_000 });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/No space left on device/);
    await runner.exec(name, ['rm', '-f', '/build/fill.bin']);
  });

  it('IT-11 missing main.tex → FAILED with one message (C10, C11)', async () => {
    const r = await svc.compile(proj('nomain', 'logs'));
    expect(r.status).toBe('FAILED');
    expect(r.log).toEqual([{ level: 'ERROR', message: 'main.tex not found in the project root.' }]);
  });

  it('IT-12 every sandbox limit is applied (Step 14 checklist)', async () => {
    const items = await checkRunningContainer(runner, runner.containerName(basic.id));
    expect(items.filter((i) => !i.pass)).toEqual([]);
  });
});
