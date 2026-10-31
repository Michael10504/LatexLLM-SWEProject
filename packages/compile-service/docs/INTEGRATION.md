# WS-3 in the Electron shell: setup and wiring

WS-3 (compile sandbox + PDF preview, IF-03) is the package `packages/compile-service`. It is wired into Member 2's
Electron shell at the repo root. This page says how to set the app up and where each piece lives.

## 1. One-time setup

Use the root [README](../../../README.md) and `python scripts/setup.py`.
The integrated workspace uses Node 22.12+, Electron 35.7.5 and
better-sqlite3 11.10.0. A native C++ toolchain is needed only if a prebuilt
binding is unavailable. Python 3.11+ runs local AI. Docker is required for
real compilation:

```powershell
docker build -t ltx-sandbox:1 packages/compile-service/docker
python scripts/run.py
```

`python scripts/run.py --stub` enables clearly labelled demo adapters without
Docker or model/provider dependencies, while keeping normal authentication.

## 2. What runs where

| Layer | Member 2 (WS2) | WS-3 |
| --- | --- | --- |
| Renderer | `renderer.ts` (login, project overlay, CodeMirror editor, auto-save; sets `window.EditorView`, fires `app:projectOpened`/`app:projectClosed`) | `apps/desktop/src/renderer/ws3/compilePanel.ts` → `dist/renderer/ws3.js` (esbuild, ES module): Compile/Cancel, status + timer, Outdated banner, clickable log, pdf.js preview; `apps/desktop/src/renderer/ws3.css` |
| Preload | `window.electronAPI` | `window.ws3` (`compile`, `cancel`, `getLatestLog`, `getPdf`, `resolveLogClick`, `info`, `projectOpened`) |
| Main | `FileStore`, `ProjectRepository` (+ `getProject(id)`) | `apps/desktop/src/main/ws3.ts` `registerWs3(ipcMain, { cacheDir, resolveProject })` |
| Package | | `@latexllm/compile-service` (`DockerCompileService`, `SandboxRunner`, `LogParser`, `registerCompileIpc`) |

The renderer only sends a project id. `main.ts` resolves it with
`integration.project(id)` before returning `{ id, rootDir: fileStore.getProjectPath(id) }`, so the renderer can never
choose a folder to mount. `lastGood.pdf` lives in `userData/compile-cache` (D4).

Environment switches (off by default): `LTX_STUB_COMPILE=1` (stub compiler), `LTX_DEV=1` (skip-login link, so WS-3 can be
tested without the backend running; it enters the app as user `dev`).

## 3. pdf.js

`pdfjs-dist` is pinned to **5.4.624**. The desktop build script
`apps/desktop/scripts/build-renderers.mjs` bundles the panel and copies
`pdf.worker.min.mjs` beside `ws3.js`; the CSP permits local workers only.

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

## 5. Integration boundaries

Main-process project ownership/role checks and FileStore path containment now
protect the compile resolver and editor IPC. Authentication uses the shared
privacy gateway. The desktop's project metadata remains local SQLite; server
project synchronization, sharing and a file-tree UI are separate features.
See the root `docs/INTEGRATION.md` and `docs/VERIFICATION.md` for the complete
scope and executed checks.
