# WS-3 in the Electron shell: setup and wiring

WS-3 (compile sandbox + PDF preview, IF-03) is the package `packages/compile-service`. It is wired into Member 2's
Electron shell at the repo root. This page says how to set the app up and where each piece lives.

## 1. One-time setup (Windows, every team member)

| Need | Why |
| --- | --- |
| Node **22.12+** (`nvm install 22` then `nvm use 22`, admin terminal) | Electron 45, better-sqlite3 13 and @electron/rebuild require it (`engines` in `package.json`) |
| **Visual Studio Build Tools 2022** with the **"Desktop development with C++"** workload | better-sqlite3 13 ships no Windows binaries, so `npm install` compiles it (once for Node, once for Electron) |
| Python 3 (already installed on most machines) | node-gyp uses it |
| Docker Desktop (WSL2, at least 4 CPUs / 4 GB) + the sandbox image | `cd packages/compile-service/docker` then `docker build -t ltx-sandbox:1 .` (or pull it) |

Then, from the repo root (the Electron shell lives in `client/`, the backend in `server/`):

```
cd packages/compile-service && npm install && cd ../..
cd client
npm install          # postinstall runs: electron-rebuild -f -o better-sqlite3
npm run build        # compile-service -> shell (tsc) -> renderer + WS-3 bundles (esbuild) -> html/css
npm start            # or: npm run start:dev  (adds a "Skip login (dev mode)" link)
```

`npm run start:stub` uses `StubCompileService` (sample PDF, no Docker) for UI work on machines without Docker.

If `npm install` stops at `gyp ERR! find VS`, the C++ workload is missing: install it and run `npm install` again.

## 2. What runs where

| Layer | Member 2 (WS2) | WS-3 |
| --- | --- | --- |
| Renderer | `renderer.ts` (login, project overlay, CodeMirror editor, auto-save; sets `window.EditorView`, fires `app:projectOpened`/`app:projectClosed`) | `client/src/renderer/ws3/compilePanel.ts` → `dist/renderer/ws3.js` (esbuild, ES module): Compile/Cancel, status + timer, Outdated banner, clickable log, pdf.js preview; `client/src/renderer/ws3.css` |
| Preload | `window.electronAPI` | `window.ws3` (`compile`, `cancel`, `getLatestLog`, `getPdf`, `resolveLogClick`, `info`, `projectOpened`) |
| Main | `FileStore`, `ProjectRepository` (+ `getProject(id)`) | `client/src/main/ws3.ts` `registerWs3(ipcMain, { cacheDir, resolveProject })` |
| Package | | `@latexllm/compile-service` (`DockerCompileService`, `SandboxRunner`, `LogParser`, `registerCompileIpc`) |

The renderer only sends a project id. `main.ts` resolves it with
`projectRepo.getProject(id) ? { id, rootDir: fileStore.getProjectPath(id) } : undefined`, so the renderer can never
choose a folder to mount. `lastGood.pdf` lives in `userData/compile-cache` (D4).

Environment switches (off by default): `LTX_STUB_COMPILE=1` (stub compiler), `LTX_DEV=1` (skip-login link, so WS-3 can be
tested without the backend running; it enters the app as user `dev`).

## 3. pdf.js

`pdfjs-dist` is pinned to **5.4.624**. Newer releases (5.5+, 6.x) call `Map.prototype.getOrInsertComputed`, which
Chromium in Electron 40 lacks; 5.4.624 works on Electron 40 and 45. `scripts/build-ws3.mjs` copies
`pdf.worker.min.mjs` next to `ws3.js`; the CSP adds `worker-src 'self'`.

## 4. Shell contract (Step 9, Member 2)

`renderer.ts` (loaded before `ws3.js`) provides, on `window`:

```ts
window.EditorView = {
  open(relativePath: string): Promise<void>; // load another project file into CodeMirror (flushes auto-save first)
  setCursor(line: number): void;             // select the line and scroll it into view
  saveAll(): Promise<void>;                  // flush a pending auto-save; called before every compile (C1)
};
// events: 'app:projectOpened' {detail: {id}}, 'app:projectClosed'; listens for 'ws3:devLogin' (LTX_DEV=1)
```

Auto-save writes to the file currently shown (`activeFile`), not always `main.tex`.

## 5. Still needed from other workstreams

- Member 2: reject `..` in `FileStore` paths; project names unique per owner, not globally; a way back to the project
  list without logging out; a file tree (the editor only opens other files via log clicks).
- Member 1 + 2: `AuthClient` reads `data.message`, the backend sends `{ error }`, so backend messages are not shown;
  the shell keeps projects in local SQLite while the backend has `/projects` with roles; HTTPS (NFR-08) once certs exist.
