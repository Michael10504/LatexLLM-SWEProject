/**
 * Steps 6 + 7 smoke test against REAL Docker (Docker Desktop running, image ltx-sandbox:1 built):
 *   npm run smoke:compile
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DockerCompileService } from '../src/compile/DockerCompileService';
import { SandboxRunner } from '../src/sandbox/SandboxRunner';

const FIX = path.resolve(__dirname, '../fixtures');
const CACHE = path.resolve(__dirname, 'out/cache');
const runner = new SandboxRunner(undefined, { logger: { warn: console.warn, debug: () => {} } });
// Normal compiles use the real 60 s limit: a cold first build can take well over 10 s.
const svc = new DockerCompileService({ cacheDir: CACHE, sandbox: runner });
// Short limit only for the infinite-loop checks, so they don't take a full minute each.
const loopSvc = new DockerCompileService({ cacheDir: CACHE, sandbox: runner, timeoutMs: 10_000 });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const proj = (id: string, dir: string) => ({ id: `smoke6-${id}`, rootDir: path.join(FIX, dir) });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`cleanupOrphans removed ${await runner.cleanupOrphans()} container(s)`);

  // 1. SUCCESS + lastGood.pdf in the cache
  const basic = proj('basic', 'basic');
  const r1 = await svc.compile(basic);
  const pdfOk = !!r1.pdfPath && fs.readFileSync(r1.pdfPath).subarray(0, 5).toString() === '%PDF-';
  check('basic → SUCCESS with lastGood.pdf in the cache', r1.status === 'SUCCESS' && pdfOk && r1.pdfPath!.startsWith(CACHE), `${r1.durationMs} ms, ${r1.pdfPath}`);
  console.log('      log:', JSON.stringify(r1.log));

  // 2. Warm recompile is fast
  const r2 = await svc.compile(basic);
  check('warm recompile → SUCCESS', r2.status === 'SUCCESS', `${r2.durationMs} ms`);

  // 3. FAILED with a clickable error (Step 7 parser on a real log)
  const r3 = await svc.compile(proj('error', 'error'));
  const err = r3.log.find((e) => e.level === 'ERROR');
  check('error → FAILED with main.tex:5 Undefined control sequence', r3.status === 'FAILED' && err?.file === 'main.tex' && err.line === 5, JSON.stringify(err));
  check('error → partial PDF ignored (no lastGood for this project)', r3.pdfPath === undefined);

  // 4. TIMEOUT kills TeX and leaves the container usable
  const loop = proj('loop', 'infinite-loop');
  const t0 = Date.now();
  const r4 = await loopSvc.compile(loop);
  check('infinite loop → TIMEOUT after ~10 s', r4.status === 'TIMEOUT' && Date.now() - t0 < 25_000, `${r4.durationMs} ms`);
  const ps = await runner.exec(runner.containerName(loop.id), ['ps', '-eo', 'stat=,comm=']);
  check('no TeX left running after TIMEOUT', !/^[^Z]\S*\s+(latexmk|pdflatex)/m.test(ps.stdout.toString()));

  // 5. A second compile supersedes the first → CANCELLED
  const a = loopSvc.compile(loop);
  await wait(3000);
  const b = loopSvc.compile(loop);
  await wait(2000);
  await loopSvc.cancel(loop.id);
  const [ra, rb] = await Promise.all([a, b]);
  check('second compile cancels the first', ra.status === 'CANCELLED', ra.status);
  check('cancel() stops the second', rb.status === 'CANCELLED', rb.status);

  // 6. Missing main.tex → FAILED (C11)
  const r6 = await svc.compile(proj('nomain', 'logs'));
  check('folder without main.tex → FAILED with one message', r6.status === 'FAILED' && r6.log.length === 1, r6.log[0]?.message);

  // 7. Failed build after a good one keeps the old PDF (demo flow 3)
  //    Reuse the basic project id but point it at the error folder.
  const r7 = await svc.compile({ id: basic.id, rootDir: path.join(FIX, 'error') });
  check('failed build keeps the previous lastGood.pdf', r7.status === 'FAILED' && r7.pdfPath === r1.pdfPath);

  for (const p of [basic, loop, proj('error', 'error')]) await runner.stop(p.id);
  console.log(failures === 0 ? '\nALL STEP 6/7 SMOKE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
}

main()
  .catch((e) => {
    console.error('Smoke run crashed:', e);
    failures++;
  })
  .finally(() => process.exit(failures ? 1 : 0));
