import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DockerCompileService, SandboxPort } from '../../src/compile/DockerCompileService';
import { ContainerGoneError, ProjectInvalidError, SandboxUnavailableError } from '../../src/sandbox/errors';
import type { DockerResult } from '../../src/sandbox/runDocker';

const PDF = Buffer.from('%PDF-1.5 good');
const ERROR_LOG = fs.readFileSync(path.join(__dirname, '../../fixtures/logs/undefined-command.log'));
const OK_LOG = Buffer.from('(./main.tex\nOutput written on /build/main.pdf (1 page, 100 bytes).\n)');
const res = (code: number, stderr = ''): DockerResult => ({ code, stdout: Buffer.alloc(0), stderr });

/** A latexmk run the test finishes by hand (or that ends when its AbortSignal fires → 137). */
function controllable() {
  let finish!: (r: DockerResult) => void;
  const run = jest.fn((_name: string, opts: { signal?: AbortSignal } = {}) =>
    new Promise<DockerResult>((resolve) => {
      finish = resolve;
      opts.signal?.addEventListener('abort', () => resolve(res(137)), { once: true });
    }),
  );
  return { run, finish: (r: DockerResult) => finish(r) };
}

function fakeSandbox(over: Partial<Record<keyof SandboxPort, jest.Mock>> = {}) {
  const order: string[] = [];
  const track = <T>(label: string, impl: (...a: any[]) => T) => jest.fn((...a: any[]) => (order.push(label), impl(...a)));
  const sb = {
    ensureRunning: track('ensure', async (id: string) => `ltx-${id}`),
    prepareBuildDirs: track('prep', async () => res(0)),
    runLatexmk: track('latexmk', async () => res(0)),
    copyOut: track('copy', async () => PDF),
    readLog: track('log', async () => OK_LOG),
    killTex: track('kill', async () => 'killed' as const),
    ...over,
  };
  return { sb: sb as unknown as SandboxPort & Record<keyof SandboxPort, jest.Mock>, order };
}

let cache: string;
const project = { id: 'p1', rootDir: '/proj' };
const make = (sb: SandboxPort, timeoutMs = 60_000) =>
  new DockerCompileService({ cacheDir: cache, sandbox: sb, timeoutMs, logger: { warn: jest.fn() } });

beforeEach(() => {
  cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-cache-'));
});
afterEach(() => fs.rmSync(cache, { recursive: true, force: true }));

describe('DockerCompileService status mapping', () => {
  it('SUCCESS: exit 0 → copies the PDF to lastGood.pdf in the app cache (D4)', async () => {
    const { sb, order } = fakeSandbox();
    const svc = make(sb);
    const r = await svc.compile(project);
    expect(r.status).toBe('SUCCESS');
    expect(r.pdfPath).toBe(svc.lastGoodPath('p1'));
    expect(r.pdfPath!.startsWith(cache)).toBe(true);
    expect(fs.readFileSync(r.pdfPath!)).toEqual(PDF);
    expect(order).toEqual(['ensure', 'prep', 'latexmk', 'log', 'copy']);
    expect(svc.getLatestLog(project)).toEqual(r.log);
    expect(svc.getLastGoodPdf('p1')).toBe(r.pdfPath);
  });

  it('FAILED: non-zero exit → parsed errors, partial PDF ignored, last good PDF kept (C5)', async () => {
    const { sb } = fakeSandbox();
    const svc = make(sb);
    await svc.compile(project); // creates a lastGood.pdf
    sb.runLatexmk.mockResolvedValueOnce(res(12));
    sb.readLog.mockResolvedValueOnce(ERROR_LOG);
    sb.copyOut.mockClear();
    const r = await svc.compile(project);
    expect(r.status).toBe('FAILED');
    expect(r.log).toContainEqual({ level: 'ERROR', file: 'main.tex', line: 5, message: 'Undefined control sequence.' });
    expect(sb.copyOut).not.toHaveBeenCalled();
    expect(r.pdfPath).toBe(svc.lastGoodPath('p1')); // shown with an Outdated banner
    expect(fs.readFileSync(r.pdfPath!)).toEqual(PDF);
    expect(svc.getLatestLog(project)).toEqual(r.log);
  });

  it('FAILED with no parsable error still gets one ERROR entry', async () => {
    const { sb } = fakeSandbox({ runLatexmk: jest.fn(async () => res(2, 'Latexmk: something odd\n')) });
    const r = await make(sb).compile(project);
    expect(r.status).toBe('FAILED');
    expect(r.log[0]).toEqual({ level: 'ERROR', message: 'Compilation failed (latexmk exit code 2). Latexmk: something odd' });
    expect(r.pdfPath).toBeUndefined(); // nothing was ever built
  });

  it('FAILED: exit 0 but no PDF', async () => {
    const { sb } = fakeSandbox({ copyOut: jest.fn(async () => null) });
    const r = await make(sb).compile(project);
    expect(r.status).toBe('FAILED');
    expect(r.log[0].message).toMatch(/no PDF/);
  });

  it('FAILED "resource limit": exit 137 without timer or cancel (C6)', async () => {
    const { sb } = fakeSandbox({ runLatexmk: jest.fn(async () => res(137)) });
    const r = await make(sb).compile(project);
    expect(r.status).toBe('FAILED');
    expect(r.log[0].message).toMatch(/resource limit/);
    expect(sb.killTex).not.toHaveBeenCalled();
  });

  it('TIMEOUT: kills TeX when the timer fires and keeps the log', async () => {
    const c = controllable();
    const { sb } = fakeSandbox({ runLatexmk: c.run });
    const r = await make(sb, 30).compile(project);
    expect(r.status).toBe('TIMEOUT');
    expect(sb.killTex).toHaveBeenCalledWith('ltx-p1');
    expect(r.log[0].message).toMatch(/stopped after 0 s/);
    expect(r.log).toContainEqual(expect.objectContaining({ level: 'INFO' })); // the parsed log follows
  });

  it('FAILED (C11): missing main.tex, without touching Docker further', async () => {
    const { sb } = fakeSandbox({
      ensureRunning: jest.fn(async () => {
        throw new ProjectInvalidError('main.tex not found in the project root.');
      }),
    });
    const r = await make(sb).compile(project);
    expect(r).toMatchObject({ status: 'FAILED', log: [{ level: 'ERROR', message: 'main.tex not found in the project root.' }] });
    expect(sb.runLatexmk).not.toHaveBeenCalled();
  });

  it('SANDBOX_UNAVAILABLE: Docker is down', async () => {
    const { sb } = fakeSandbox({
      ensureRunning: jest.fn(async () => {
        throw new SandboxUnavailableError('Docker Desktop is not running. Start it and compile again.');
      }),
    });
    const r = await make(sb).compile(project);
    expect(r.status).toBe('SANDBOX_UNAVAILABLE');
    expect(r.log).toEqual([{ level: 'ERROR', message: 'Docker Desktop is not running. Start it and compile again.' }]);
  });

  it('retries once when the container vanished, then succeeds', async () => {
    const { sb } = fakeSandbox();
    sb.runLatexmk.mockRejectedValueOnce(new ContainerGoneError('No such container'));
    const r = await make(sb).compile(project);
    expect(r.status).toBe('SUCCESS');
    expect(sb.ensureRunning).toHaveBeenCalledTimes(2);
  });

  it('SANDBOX_UNAVAILABLE when the container vanishes twice', async () => {
    const { sb } = fakeSandbox({
      runLatexmk: jest.fn(async () => {
        throw new ContainerGoneError('No such container');
      }),
    });
    const r = await make(sb).compile(project);
    expect(r.status).toBe('SANDBOX_UNAVAILABLE');
    expect(r.log[0].message).toMatch(/keeps disappearing/);
  });

  it('FAILED "Internal error" for anything unexpected', async () => {
    const { sb } = fakeSandbox({ prepareBuildDirs: jest.fn(async () => { throw new Error('boom'); }) });
    const r = await make(sb).compile(project);
    expect(r).toMatchObject({ status: 'FAILED', log: [{ level: 'ERROR', message: 'Internal error: boom' }] });
  });
});

describe('DockerCompileService jobs (cancel / supersede / stale results)', () => {
  it('a second compile cancels the first, kills its TeX, and only then starts latexmk', async () => {
    const first = controllable();
    const { sb, order } = fakeSandbox();
    sb.runLatexmk.mockImplementationOnce(first.run);
    const svc = make(sb);
    const p1 = svc.compile(project);
    await new Promise((r) => setImmediate(r)); // let job 1 reach latexmk
    const p2 = svc.compile(project);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('CANCELLED');
    expect(r2.status).toBe('SUCCESS');
    const kill = order.indexOf('kill');
    expect(kill).toBeGreaterThan(-1);
    expect(order.lastIndexOf('latexmk')).toBeGreaterThan(kill); // job 2's latexmk after the kill
  });

  it('cancel() stops the running job; the latest log is not replaced by a cancelled run', async () => {
    const c = controllable();
    const { sb } = fakeSandbox();
    const svc = make(sb);
    await svc.compile(project);
    const before = svc.getLatestLog(project);
    sb.runLatexmk.mockImplementationOnce(c.run);
    const p = svc.compile(project);
    await new Promise((r) => setImmediate(r));
    await svc.cancel('p1');
    const r = await p;
    expect(r.status).toBe('CANCELLED');
    expect(r.pdfPath).toBe(svc.lastGoodPath('p1'));
    expect(sb.killTex).toHaveBeenCalledTimes(1);
    expect(svc.getLatestLog(project)).toBe(before);
  });

  it('cancel() with nothing running is a no-op', async () => {
    const { sb } = fakeSandbox();
    await expect(make(sb).cancel('nope')).resolves.toBeUndefined();
    expect(sb.killTex).not.toHaveBeenCalled();
  });

  it('a job superseded while still starting the container never runs latexmk', async () => {
    let release!: () => void;
    const { sb } = fakeSandbox();
    sb.ensureRunning.mockImplementationOnce(() => new Promise((r) => (release = () => r('ltx-p1'))));
    const svc = make(sb);
    const p1 = svc.compile(project);
    const p2 = svc.compile(project);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('CANCELLED');
    expect(r2.status).toBe('SUCCESS');
    expect(sb.runLatexmk).toHaveBeenCalledTimes(1);
  });

  it('drops a stale result: a job superseded while copying its PDF does not overwrite lastGood', async () => {
    let releaseCopy!: () => void;
    const { sb } = fakeSandbox();
    sb.copyOut.mockImplementationOnce(() => new Promise((r) => (releaseCopy = () => r(Buffer.from('%PDF-OLD')))));
    const svc = make(sb);
    const p1 = svc.compile(project);
    await new Promise((r) => setTimeout(r, 5)); // job 1 is now waiting in copyOut
    const p2 = svc.compile(project); // job 2 supersedes job 1
    releaseCopy();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe('CANCELLED');
    expect(r2.status).toBe('SUCCESS');
    expect(fs.readFileSync(svc.lastGoodPath('p1'))).toEqual(PDF);
  });

  it('projects are independent', async () => {
    const c = controllable();
    const { sb } = fakeSandbox();
    sb.runLatexmk.mockImplementationOnce(c.run);
    const svc = make(sb);
    const a = svc.compile({ id: 'a', rootDir: '/a' });
    await new Promise((r) => setImmediate(r));
    const b = await svc.compile({ id: 'b', rootDir: '/b' });
    expect(b.status).toBe('SUCCESS');
    c.finish(res(0));
    expect((await a).status).toBe('SUCCESS');
  });
});
