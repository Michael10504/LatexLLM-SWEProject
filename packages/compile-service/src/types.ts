// Public WS-3 interface (Step 2). Keep stable: Members 2 and 4 build against it.

export type CompileStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'SANDBOX_UNAVAILABLE';

export interface LogEntry {
  level: 'ERROR' | 'WARNING' | 'INFO';
  /** Path relative to the project root (e.g. "chapters/intro.tex"); absent = not clickable (D2). */
  file?: string;
  line?: number;
  message: string;
}

export interface CompileResult {
  status: CompileStatus;
  /** Host path of the PDF to show (lastGood.pdf on success). */
  pdfPath?: string;
  log: LogEntry[];
  durationMs: number;
}

/** Minimal project shape WS-3 needs. Member 1/2 may extend it. */
export interface Project {
  id: string;
  /** Absolute host path of the project folder (contains main.tex). */
  rootDir: string;
}

export interface CompileService {
  /** Cancels any running job for the same project. */
  compile(project: Project): Promise<CompileResult>;
  cancel(projectId: string): Promise<void>;
  getLatestLog(project: Project): LogEntry[];
}

/** All sandbox limits in one place (FR-02.4). Values feed the fixed docker commands. */
export interface SandboxConfig {
  dockerPath: string;
  image: string;
  cpus: number;
  memory: string;
  pidsLimit: number;
  buildTmpfs: string;
  tmpTmpfs: string;
  user: string;
  timeoutMs: number;
  label: string;
}

export const DEFAULT_SANDBOX_CONFIG: Readonly<SandboxConfig> = Object.freeze({
  dockerPath: 'docker',
  image: 'ltx-sandbox:1',
  cpus: 2,
  memory: '2g',
  pidsLimit: 256,
  buildTmpfs: '500m',
  tmpTmpfs: '64m',
  user: '1000:1000',
  timeoutMs: 60_000,
  label: 'app=ltx-sandbox',
});
