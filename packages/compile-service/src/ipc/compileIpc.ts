import * as fs from 'node:fs';
import type { CompileResult, LogEntry, Project } from '../types';
import { LogClickTarget, resolveLogClick } from '../ui/logNavigation';

/**
 * Step 8: Electron IPC for WS-3, written against tiny structural types so this package does not
 * depend on Electron. Member 2 wires it up in two lines:
 *
 *   main:    registerCompileIpc(ipcMain, compileService, (id) => projects.get(id));
 *   preload: contextBridge.exposeInMainWorld('ws3', { ...4 invoke calls, see docs/INTEGRATION.md });
 *
 * (A sandboxed preload cannot require this package, so the preload copies the channel names;
 *  createCompileApi below is the reference version and is used by the tests.)
 *
 * The renderer only ever sends a project id. The main process looks up the folder, and PDFs are
 * only read from the app cache, so a compromised renderer cannot read or mount arbitrary paths.
 */
export const WS3_CHANNELS = {
  compile: 'ws3:compile',
  cancel: 'ws3:cancel',
  getLatestLog: 'ws3:getLatestLog',
  getPdf: 'ws3:getPdf',
  resolveLogClick: 'ws3:resolveLogClick',
} as const;

/** The subset of Electron's ipcMain this module uses. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

/** The subset of Electron's ipcRenderer this module uses. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/** What the IPC layer needs from the compile service (DockerCompileService or StubCompileService). */
export interface CompileBackend {
  compile(project: Project): Promise<CompileResult>;
  cancel(projectId: string): Promise<void>;
  getLatestLog(project: Project): LogEntry[];
  /** Optional: DockerCompileService has it; the stub does not. */
  getLastGoodPdf?(projectId: string): string | undefined;
}

/** Result sent to the renderer: no host paths, just whether a PDF can be fetched with getPdf. */
export interface CompileResultForRenderer {
  status: CompileResult['status'];
  log: LogEntry[];
  durationMs: number;
  hasPdf: boolean;
}

/** The API the renderer sees as window.ws3. */
export interface Ws3Api {
  compile(projectId: string): Promise<CompileResultForRenderer>;
  cancel(projectId: string): Promise<void>;
  getLatestLog(projectId: string): Promise<LogEntry[]>;
  /** The PDF to show (last good build), or null when there is none yet. */
  getPdf(projectId: string): Promise<Uint8Array | null>;
  /** Where a click on a log entry should go (Step 9): open file + line, file not found, or nothing. */
  resolveLogClick(projectId: string, entry: LogEntry): Promise<LogClickTarget>;
}

export type ProjectResolver = (projectId: string) => Project | undefined;

function checkId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error('Invalid project id');
  }
  return value;
}

/** Register the WS-3 handlers on ipcMain. Returns a function that removes them again. */
export function registerCompileIpc(ipcMain: IpcMainLike, backend: CompileBackend, resolveProject: ProjectResolver): () => void {
  const project = (raw: unknown): Project => {
    const id = checkId(raw);
    const p = resolveProject(id);
    if (!p) throw new Error(`Unknown project: ${id}`);
    return p;
  };
  // Remembers the PDF of each project's last result, for backends without getLastGoodPdf (the stub).
  const lastPdf = new Map<string, string>();
  const pdfPathFor = (id: string): string | undefined => backend.getLastGoodPdf?.(id) ?? lastPdf.get(id);

  ipcMain.handle(WS3_CHANNELS.compile, async (_e, id) => {
    const p = project(id);
    const r = await backend.compile(p);
    if (r.pdfPath) lastPdf.set(p.id, r.pdfPath);
    const pdf = pdfPathFor(p.id);
    const out: CompileResultForRenderer = { status: r.status, log: r.log, durationMs: r.durationMs, hasPdf: !!pdf && fs.existsSync(pdf) };
    return out;
  });
  ipcMain.handle(WS3_CHANNELS.cancel, async (_e, id) => backend.cancel(checkId(id)));
  ipcMain.handle(WS3_CHANNELS.getLatestLog, async (_e, id) => backend.getLatestLog(project(id)));
  ipcMain.handle(WS3_CHANNELS.getPdf, async (_e, id) => {
    const pdf = pdfPathFor(project(id).id);
    if (!pdf || !fs.existsSync(pdf)) return null;
    // A Buffer is a Uint8Array; Electron's structured clone sends it as one.
    return fs.readFileSync(pdf);
  });
  ipcMain.handle(WS3_CHANNELS.resolveLogClick, async (_e, id, entry) => {
    const p = project(id);
    const e = entry as Partial<LogEntry> | null;
    if (!e || typeof e !== 'object' || (e.file !== undefined && typeof e.file !== 'string')) throw new Error('Invalid log entry');
    return resolveLogClick({ level: 'ERROR', message: '', file: e.file, line: typeof e.line === 'number' ? e.line : undefined }, p.rootDir);
  });

  return () => Object.values(WS3_CHANNELS).forEach((c) => ipcMain.removeHandler(c));
}

/** Build the object the preload script exposes with contextBridge.exposeInMainWorld('ws3', …). */
export function createCompileApi(ipcRenderer: IpcRendererLike): Ws3Api {
  return {
    compile: (projectId) => ipcRenderer.invoke(WS3_CHANNELS.compile, projectId) as Promise<CompileResultForRenderer>,
    cancel: (projectId) => ipcRenderer.invoke(WS3_CHANNELS.cancel, projectId) as Promise<void>,
    getLatestLog: (projectId) => ipcRenderer.invoke(WS3_CHANNELS.getLatestLog, projectId) as Promise<LogEntry[]>,
    getPdf: (projectId) => ipcRenderer.invoke(WS3_CHANNELS.getPdf, projectId) as Promise<Uint8Array | null>,
    resolveLogClick: (projectId, entry) => ipcRenderer.invoke(WS3_CHANNELS.resolveLogClick, projectId, entry) as Promise<LogClickTarget>,
  };
}
