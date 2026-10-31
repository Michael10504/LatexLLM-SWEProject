/**
 * Step 13: NFR-03 benchmark.
 *   npm run benchmark                 # 1 warm-up + 20 warm runs + 10 cold starts (about 10 minutes)
 *   npm run benchmark -- --quick      # 1 + 5 warm, 2 cold: a trial run
 * Targets: warm build p95 ≤ 10 s over 20 runs for a 5,000-word / 10-figure document; cold start ≤ 20 s.
 * Run on the Reference Machine with the AI model idle (E2). Output: docs/benchmarks/nfr03-<date>.{csv,md}
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { DockerCompileService } from '../src/compile/DockerCompileService';
import { runDocker } from '../src/sandbox/runDocker';
import { SandboxRunner } from '../src/sandbox/SandboxRunner';
import { DEFAULT_SANDBOX_CONFIG } from '../src/types';

const quick = process.argv.includes('--quick');
const WARM_RUNS = quick ? 5 : 20;
const COLD_RUNS = quick ? 2 : 10;
const WORDS = 5000;
const FIGURES = 10;
const WARM_TARGET_MS = 10_000;
const COLD_TARGET_MS = 20_000;

const OUT = path.resolve(__dirname, 'out');
const DOC = path.join(OUT, 'bench-doc');
const RESULTS = path.resolve(__dirname, '../docs/benchmarks');

// ---- deterministic test document --------------------------------------------------------
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** Minimal PNG encoder (RGB, 8-bit) using node:zlib, so no image library is needed. */
export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const VOCAB = ('sandbox compile latex document figure section result analysis method system model data value test measure ' +
  'performance container process limit network memory output build preview error warning project editor local language ' +
  'student course design review report table chapter theory example proof equation reference citation author paper').split(' ');

export function makeDocument(): { words: number; figureBytes: number[] } {
  fs.mkdirSync(path.join(DOC, 'figures'), { recursive: true });
  const figureBytes: number[] = [];
  for (let f = 1; f <= FIGURES; f++) {
    const img = png(640, 480, (x, y) => {
      const n = Math.floor(rand() * 24);
      return [(x * 255) / 640 / 1.2 + n, (y * 255) / 480 / 1.2 + n, ((x + y + f * 37) % 255) / 1.2 + n].map((v) => Math.min(255, Math.floor(v))) as [number, number, number];
    });
    if (img.length > 1024 * 1024) throw new Error(`figure ${f} is ${img.length} bytes, over the 1 MB limit`);
    fs.writeFileSync(path.join(DOC, 'figures', `fig${f}.png`), img);
    figureBytes.push(img.length);
  }
  const perSection = Math.ceil(WORDS / FIGURES);
  let words = 0;
  const sections: string[] = [];
  for (let s = 1; s <= FIGURES; s++) {
    const paras: string[] = [];
    let inSection = 0;
    while (inSection < perSection && words < WORDS) {
      const n = Math.min(80, perSection - inSection, WORDS - words);
      const w = Array.from({ length: n }, () => VOCAB[Math.floor(rand() * VOCAB.length)]);
      w[0] = w[0][0].toUpperCase() + w[0].slice(1);
      paras.push(`${w.join(' ')}.`);
      inSection += n;
      words += n;
    }
    sections.push(
      `\\section{Section ${s}}\n${paras.join('\n\n')}\n\n\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/fig${s}.png}\n  \\caption{Benchmark figure ${s}.}\n  \\label{fig:${s}}\n\\end{figure}\nSee Figure~\\ref{fig:${s}}.\n`,
    );
  }
  fs.writeFileSync(
    path.join(DOC, 'main.tex'),
    `\\documentclass{article}\n\\usepackage{graphicx}\n\\title{NFR-03 benchmark document}\n\\author{WS-3}\n\\begin{document}\n\\maketitle\n${sections.join('\n')}\n\\end{document}\n`,
  );
  return { words, figureBytes };
}

// ---- measurement ------------------------------------------------------------------------
/** Nearest-rank percentile (E1). */
export function nearestRank(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

async function main(): Promise<number> {
  const runner = new SandboxRunner(undefined, { logger: { warn: console.warn, debug: () => {} } });
  const svc = new DockerCompileService({ cacheDir: path.join(OUT, 'cache'), sandbox: runner, benchmark: true });
  const project = { id: 'nfr03-bench', rootDir: DOC };

  const doc = makeDocument();
  console.log(`Document: ${doc.words} words, ${FIGURES} figures (largest ${Math.max(...doc.figureBytes)} bytes)`);
  await runner.cleanupOrphans();

  const rows: { kind: string; run: number; ms: number; status: string }[] = [];
  const once = async (kind: string, run: number) => {
    const r = await svc.compile(project);
    rows.push({ kind, run, ms: r.durationMs, status: r.status });
    console.log(`${kind.padEnd(7)} #${String(run).padStart(2)}  ${(r.durationMs / 1000).toFixed(2)} s  ${r.status}`);
    if (r.status !== 'SUCCESS') throw new Error(`${kind} run ${run} did not succeed: ${JSON.stringify(r.log.slice(0, 3))}`);
  };

  // Cold: container not running → compile done (A2: the image is already built, so not counted).
  for (let i = 1; i <= COLD_RUNS; i++) {
    await runner.stop(project.id);
    await once('cold', i);
  }
  // Warm: 1 warm-up, then the measured runs, all forced full builds (-g).
  await once('warmup', 0);
  for (let i = 1; i <= WARM_RUNS; i++) await once('warm', i);
  await runner.stop(project.id);

  const warm = rows.filter((r) => r.kind === 'warm').map((r) => r.ms);
  const cold = rows.filter((r) => r.kind === 'cold').map((r) => r.ms);
  const p95 = nearestRank(warm, 95);
  const coldMax = Math.max(...cold);
  const med = (v: number[]) => nearestRank(v, 50);
  const warmPass = p95 <= WARM_TARGET_MS;
  const coldPass = coldMax <= COLD_TARGET_MS;

  const dockerInfo = (await runDocker(DEFAULT_SANDBOX_CONFIG, ['info', '--format', '{{.ServerVersion}} | {{.NCPU}} CPUs | {{.MemTotal}} bytes'])).stdout.toString().trim();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `nfr03-${stamp}.csv`), ['kind,run,duration_ms,status', ...rows.map((r) => `${r.kind},${r.run},${r.ms},${r.status}`)].join('\n') + '\n');
  const md = [
    `# NFR-03 benchmark, ${stamp.slice(0, 10)}${quick ? ' (quick trial, not a formal result)' : ''}`,
    '',
    `- **Machine:** ${os.type()} ${os.release()}, ${os.cpus()[0]?.model ?? 'unknown CPU'} (${os.cpus().length} threads), ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM`,
    `- **Docker:** ${dockerInfo}`,
    `- **Document:** ${doc.words} words, ${FIGURES} PNG figures (each ≤ 1 MB, largest ${Math.round(Math.max(...doc.figureBytes) / 1024)} KB)`,
    `- **Method:** forced full builds (\`latexmk -g\`), timed end to end through \`DockerCompileService\` (includes copying the PDF out); nearest-rank percentiles (E1). Cold = container stopped before each run; the image itself is already built (A2).`,
    '- **Reference Machine:** confirm this is the Reference Machine and the AI model was idle (E2).',
    '',
    '| Measure | Runs | Median | p95 / max | Target | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    `| Warm build | ${warm.length} | ${(med(warm) / 1000).toFixed(2)} s | p95 ${(p95 / 1000).toFixed(2)} s | p95 ≤ 10 s | ${warmPass ? 'PASS' : '**FAIL**'} |`,
    `| Cold start + build | ${cold.length} | ${(med(cold) / 1000).toFixed(2)} s | max ${(coldMax / 1000).toFixed(2)} s | ≤ 20 s | ${coldPass ? 'PASS' : '**FAIL**'} |`,
    '',
    `Raw timings: \`nfr03-${stamp}.csv\`.`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(RESULTS, `nfr03-${stamp}.md`), md);
  console.log(`\nWarm p95 ${(p95 / 1000).toFixed(2)} s (${warmPass ? 'PASS' : 'FAIL'}), cold max ${(coldMax / 1000).toFixed(2)} s (${coldPass ? 'PASS' : 'FAIL'})`);
  console.log(`Results: docs/benchmarks/nfr03-${stamp}.md`);
  return warmPass && coldPass ? 0 : 1;
}

if (require.main === module) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error('Benchmark crashed:', e);
      process.exit(1);
    },
  );
}
