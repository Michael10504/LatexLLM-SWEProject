// Bundles the WS-3 renderer panel (src/renderer/ws3) with pdf.js into dist/renderer/ws3.js
// and copies the pdf.js worker next to it. The rest of the shell is still built by plain tsc.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const outDir = 'dist/renderer';
mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: ['src/renderer/ws3/compilePanel.ts'],
    outfile: join(outDir, 'ws3.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome130',
    sourcemap: true,
    logLevel: 'info',
});

const pdfjsBuild = dirname(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'));
copyFileSync(join(pdfjsBuild, 'pdf.worker.min.mjs'), join(outDir, 'pdf.worker.min.mjs'));
console.log('copied pdf.worker.min.mjs');
