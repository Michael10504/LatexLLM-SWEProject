import type { IpcMain } from 'electron';
import { app } from 'electron';
import {
    DockerCompileService,
    SandboxRunner,
    StubCompileService,
    registerCompileIpc,
    type CompileBackend,
    type ProjectResolver
} from '@latexllm/compile-service';

/**
 * WS-3 wiring for the Electron main process.
 *
 * Environment switches (all off by default):
 *   LTX_STUB_COMPILE=1  use StubCompileService (no Docker; sample PDF after 1 s)
 *   LTX_DEV=1           renderer may skip the login overlay (dev only: auth backend not wired yet)
 */
export interface Ws3Options {
    cacheDir: string;
    resolveProject: ProjectResolver;
}

export function registerWs3(ipcMain: IpcMain, opts: Ws3Options): void {
    const useStub = process.env.LTX_STUB_COMPILE === '1';
    const runner = useStub ? undefined : new SandboxRunner();
    const service: CompileBackend = runner
        ? new DockerCompileService({ cacheDir: opts.cacheDir, sandbox: runner })
        : new StubCompileService();

    // B5: remove containers left over from a crash. Runs in the background so the window opens at once
    // (Docker can take a while to answer while it starts); compiles wait for it. Never throws.
    const orphansCleaned: Promise<unknown> = runner ? runner.cleanupOrphans() : Promise.resolve(0);
    const backend: CompileBackend = {
        compile: async (p) => { await orphansCleaned; return service.compile(p); },
        cancel: (id) => service.cancel(id),
        getLatestLog: (p) => service.getLatestLog(p),
        getLastGoodPdf: service.getLastGoodPdf?.bind(service)
    };

    registerCompileIpc(ipcMain, backend, opts.resolveProject);

    // Tells the renderer which mode it runs in (shown in the status bar; enables the dev login skip).
    ipcMain.handle('ws3:info', () => ({ stub: useStub, dev: process.env.LTX_DEV === '1' }));

    // Stop the warm containers on exit (B5). Containers are named per project, so stop the ones we used.
    const used = new Set<string>();
    ipcMain.on('ws3:projectOpened', (_e, id: unknown) => {
        if (typeof id === 'string' && id.length > 0 && id.length <= 200) used.add(id);
    });
    let stopping = false;
    app.on('before-quit', (event) => {
        if (!runner || stopping || used.size === 0) return;
        stopping = true;
        event.preventDefault();
        Promise.allSettled([...used].map((id) => runner.stop(id))).finally(() => app.quit());
    });
}
