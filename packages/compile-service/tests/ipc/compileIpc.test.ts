import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CompileBackend, createCompileApi, IpcMainLike, registerCompileIpc, WS3_CHANNELS } from '../../src/ipc/compileIpc';
import { StubCompileService } from '../../src/StubCompileService';
import type { CompileResult } from '../../src/types';

/** Fake ipcMain + ipcRenderer pair: invoke() calls the registered handler, like Electron does. */
function fakeIpc() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (c, l) => {
      if (handlers.has(c)) throw new Error(`Attempted to register a second handler for '${c}'`);
      handlers.set(c, l);
    },
    removeHandler: (c) => void handlers.delete(c),
  };
  const ipcRenderer = {
    invoke: async (c: string, ...a: unknown[]) => {
      const h = handlers.get(c);
      if (!h) throw new Error(`No handler registered for '${c}'`);
      return h({}, ...a);
    },
  };
  return { ipcMain, ipcRenderer, handlers };
}

const projects = new Map([['p1', { id: 'p1', rootDir: '/proj/p1' }]]);
const resolve = (id: string) => projects.get(id);

describe('Step 8 IPC', () => {
  it('registers exactly the five ws3 channels and removes them again', () => {
    const { ipcMain, handlers } = fakeIpc();
    const off = registerCompileIpc(ipcMain, new StubCompileService(1), resolve);
    expect([...handlers.keys()].sort()).toEqual(Object.values(WS3_CHANNELS).sort());
    off();
    expect(handlers.size).toBe(0);
  });

  it('compile → result without host paths, then getPdf returns the PDF bytes (stub backend)', async () => {
    const { ipcMain, ipcRenderer } = fakeIpc();
    registerCompileIpc(ipcMain, new StubCompileService(1), resolve);
    const api = createCompileApi(ipcRenderer);
    const r = await api.compile('p1');
    expect(r).toMatchObject({ status: 'SUCCESS', hasPdf: true });
    expect(r).not.toHaveProperty('pdfPath');
    const pdf = await api.getPdf('p1');
    expect(Buffer.from(pdf!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await api.getLatestLog('p1')).toHaveLength(0);
  });

  it('uses getLastGoodPdf when the backend has one (DockerCompileService)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-ipc-'));
    const pdfPath = path.join(dir, 'lastGood.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.5 last good');
    const failed: CompileResult = { status: 'FAILED', log: [{ level: 'ERROR', file: 'main.tex', line: 5, message: 'x' }], durationMs: 5, pdfPath };
    const backend: CompileBackend = {
      compile: jest.fn(async () => failed),
      cancel: jest.fn(async () => {}),
      getLatestLog: () => failed.log,
      getLastGoodPdf: () => pdfPath,
    };
    const { ipcMain, ipcRenderer } = fakeIpc();
    registerCompileIpc(ipcMain, backend, resolve);
    const api = createCompileApi(ipcRenderer);
    await expect(api.compile('p1')).resolves.toMatchObject({ status: 'FAILED', hasPdf: true });
    expect(Buffer.from((await api.getPdf('p1'))!).toString()).toBe('%PDF-1.5 last good');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getPdf is null before anything was built', async () => {
    const { ipcMain, ipcRenderer } = fakeIpc();
    registerCompileIpc(ipcMain, new StubCompileService(1), resolve);
    await expect(createCompileApi(ipcRenderer).getPdf('p1')).resolves.toBeNull();
  });

  it('cancel forwards the project id', async () => {
    const backend = { compile: jest.fn(), cancel: jest.fn(async () => {}), getLatestLog: () => [] } as unknown as CompileBackend;
    const { ipcMain, ipcRenderer } = fakeIpc();
    registerCompileIpc(ipcMain, backend, resolve);
    await createCompileApi(ipcRenderer).cancel('p1');
    expect(backend.cancel).toHaveBeenCalledWith('p1');
  });

  it('rejects unknown projects and bad ids (the renderer cannot pick folders)', async () => {
    const { ipcMain, ipcRenderer } = fakeIpc();
    const backend = new StubCompileService(1);
    const spy = jest.spyOn(backend, 'compile');
    registerCompileIpc(ipcMain, backend, resolve);
    const api = createCompileApi(ipcRenderer);
    await expect(api.compile('nope')).rejects.toThrow('Unknown project: nope');
    await expect(ipcRenderer.invoke(WS3_CHANNELS.compile, { id: 'p1', rootDir: 'C:/Windows' })).rejects.toThrow('Invalid project id');
    await expect(ipcRenderer.invoke(WS3_CHANNELS.getPdf, '')).rejects.toThrow('Invalid project id');
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolveLogClick runs in main against the project folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-proj-'));
    fs.mkdirSync(path.join(dir, 'chapters'));
    fs.writeFileSync(path.join(dir, 'chapters', 'intro.tex'), 'x');
    const { ipcMain, ipcRenderer } = fakeIpc();
    registerCompileIpc(ipcMain, new StubCompileService(1), (id) => (id === 'p1' ? { id, rootDir: dir } : undefined));
    const api = createCompileApi(ipcRenderer);
    await expect(api.resolveLogClick('p1', { level: 'ERROR', file: 'chapters/intro.tex', line: 3, message: 'x' })).resolves.toMatchObject({ kind: 'open', line: 3 });
    await expect(api.resolveLogClick('p1', { level: 'ERROR', file: 'gone.tex', line: 1, message: 'x' })).resolves.toEqual({ kind: 'file-not-found', file: 'gone.tex' });
    await expect(api.resolveLogClick('p1', { level: 'WARNING', message: 'x' })).resolves.toEqual({ kind: 'not-clickable' });
    await expect(api.resolveLogClick('p1', { level: 'ERROR', file: '../../etc/passwd', line: 1, message: 'x' })).resolves.toEqual({ kind: 'not-clickable' });
    await expect(ipcRenderer.invoke(WS3_CHANNELS.resolveLogClick, 'p1', 'not an entry')).rejects.toThrow('Invalid log entry');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
