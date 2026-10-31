import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
mkdirSync('dist/renderer', { recursive: true });
await build({ entryPoints: ['src/renderer/renderer.ts'], bundle: true, platform: 'browser', format: 'iife',
    target: 'chrome130', outfile: 'dist/renderer/renderer.js' });
await build({ entryPoints: ['src/renderer/ws3/compilePanel.ts'], bundle: true, platform: 'browser', format: 'esm',
    target: 'chrome130', outfile: 'dist/renderer/ws3.js' });
await build({ entryPoints: ['src/preload/preload.ts'], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: 'dist/preload/preload.js' });
for (const file of readdirSync('src/renderer')) {
    if (/\.(html|css)$/.test(file)) copyFileSync(join('src/renderer', file), join('dist/renderer', file));
}
copyFileSync(join(dirname(require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')), 'pdf.worker.min.mjs'), 'dist/renderer/pdf.worker.min.mjs');
