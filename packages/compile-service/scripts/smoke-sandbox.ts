/**
 * Step 5 smoke test against REAL Docker. Run by hand on the dev machine:
 *   npm run smoke            (Docker Desktop must be running, image ltx-sandbox:1 built)
 *   npm run smoke -- --docker-down   (run once with Docker Desktop quit, expects SANDBOX_UNAVAILABLE)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SandboxRunner, texAlive } from '../src/sandbox/SandboxRunner';
import { SandboxUnavailableError } from '../src/sandbox/errors';

const FIX = path.resolve(__dirname, '../fixtures');
const OUT = path.resolve(__dirname, 'out');
const runner = new SandboxRunner(undefined, { logger: { warn: console.warn, debug: () => {} } });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const secs = (t0: number) => ((Date.now() - t0) / 1000).toFixed(2) + ' s';

async function dockerDown(): Promise<void> {
  try {
    await runner.ensureRunning('smoke-basic', path.join(FIX, 'basic'));
    check('Docker down → SandboxUnavailableError', false, 'ensureRunning succeeded');
  } catch (e) {
    check('Docker down → SandboxUnavailableError', e instanceof SandboxUnavailableError, (e as Error).message);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--docker-down')) return dockerDown();
  fs.mkdirSync(OUT, { recursive: true });

  const removed = await runner.cleanupOrphans();
  console.log(`cleanupOrphans removed ${removed} container(s)`);

  // 1. basic: cold start + compile + copy out
  let t0 = Date.now();
  const basic = await runner.ensureRunning('smoke-basic', path.join(FIX, 'basic'));
  const mirror = await runner.prepareBuildDirs(basic);
  const dirs = await runner.exec(basic, ['test', '-d', '/build/chapters']);
  check('subfolders mirrored into /build (C8)', mirror.code === 0 && dirs.code === 0, `mirror exit ${mirror.code}, /build/chapters ${dirs.code === 0 ? 'exists' : 'missing'}`);
  const r1 = await runner.runLatexmk(basic, { benchmark: true });
  const pdf = await runner.copyOut(basic, '/build/main.pdf');
  check('basic compiles (exit 0) and copies out a PDF', r1.code === 0 && !!pdf, `exit ${r1.code}, ${pdf?.length ?? 0} bytes, ${secs(t0)} cold`);
  if (pdf) fs.writeFileSync(path.join(OUT, 'basic.pdf'), pdf);

  // 2. warm reuse: no new container
  t0 = Date.now();
  const again = await runner.ensureRunning('smoke-basic', path.join(FIX, 'basic'));
  check('ensureRunning reuses the warm container', again === basic && Date.now() - t0 < 5000, secs(t0));

  // 3. error fixture: exit 12 and the file:line message in the log
  const err = await runner.ensureRunning('smoke-error', path.join(FIX, 'error'));
  await runner.prepareBuildDirs(err);
  const r3 = await runner.runLatexmk(err);
  const log = (await runner.readLog(err))?.toString('utf8') ?? '';
  check('error fixture exits non-zero', r3.code !== 0, `exit ${r3.code}`);
  check('log has ./main.tex:5: Undefined control sequence.', log.includes('main.tex:5: Undefined control sequence.'));

  // 4. infinite loop: killTex stops TeX and leaves the container running
  const loop = await runner.ensureRunning('smoke-loop', path.join(FIX, 'infinite-loop'));
  await runner.prepareBuildDirs(loop);
  const ac = new AbortController();
  const running = runner.runLatexmk(loop, { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 5000));
  const how = await runner.killTex(loop);
  ac.abort();
  await running.catch(() => undefined);
  const procs = (await runner.exec(loop, ['ps', '-eo', 'stat=,comm='])).stdout.toString();
  check('killTex stops TeX without a restart, container still up', !texAlive(procs) && how !== 'restarted', `result: ${how}`);

  // 5. C10: missing main.tex is rejected before Docker
  try {
    await runner.ensureRunning('smoke-empty', path.join(FIX, 'logs'));
    check('missing main.tex rejected', false);
  } catch (e) {
    check('missing main.tex rejected', /main\.tex not found/.test((e as Error).message));
  }

  // 6. stop everything
  for (const id of ['smoke-basic', 'smoke-error', 'smoke-loop']) await runner.stop(id);
  const left = await runner.cleanupOrphans();
  check('no sandbox containers left after stop()', left === 0, `${left} left`);

  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  console.log(`PDF written to ${path.join(OUT, 'basic.pdf')} — open it and check the figure and citation.`);
}

main()
  .catch((e) => {
    console.error('Smoke run crashed:', e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
