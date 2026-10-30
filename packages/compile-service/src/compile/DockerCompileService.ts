import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLatexLog } from '../log/LogParser';
import { ContainerGoneError, ProjectInvalidError, SandboxUnavailableError } from '../sandbox/errors';
import { containerName } from '../sandbox/paths';
import { SandboxRunner } from '../sandbox/SandboxRunner';
import type { CompileResult, CompileService, CompileStatus, LogEntry, Project, SandboxConfig } from '../types';
import { DEFAULT_SANDBOX_CONFIG } from '../types';

/** The parts of SandboxRunner that CompileService uses (lets tests pass a fake). */
export type SandboxPort = Pick<SandboxRunner, 'ensureRunning' | 'prepareBuildDirs' | 'runLatexmk' | 'copyOut' | 'readLog' | 'killTex'>;

export interface CompileServiceOptions {
  /** App cache folder (D4). lastGood.pdf goes to <cacheDir>/<project folder>/lastGood.pdf. Electron: app.getPath('userData'). */
  cacheDir: string;
  config?: SandboxConfig;
  sandbox?: SandboxPort;
  /** Defaults to config.timeoutMs (60 s, FR-02.4 / C4). */
  timeoutMs?: number;
  /** Adds -g to latexmk. Benchmarks only (E1). */
  benchmark?: boolean;
  now?: () => number;
  logger?: Pick<Console, 'warn'>;
}

type StopReason = 'superseded' | 'user' | 'timeout';

interface Job {
  id: number;
  ac: AbortController;
  stopReason?: StopReason;
  container?: string;
  killing?: Promise<void>;
  timer?: NodeJS.Timeout;
  done: boolean;
}

/**
 * Step 6: the real CompileService. One job per project at a time; a new compile or cancel()
 * stops the running one (kills TeX inside the container) before anything else starts.
 */
export class DockerCompileService implements CompileService {
  private readonly sandbox: SandboxPort;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log: Pick<Console, 'warn'>;
  private seq = 0;
  private readonly jobs = new Map<string, Job>();
  private readonly latestLogs = new Map<string, LogEntry[]>();

  constructor(private readonly opts: CompileServiceOptions) {
    const cfg = opts.config ?? DEFAULT_SANDBOX_CONFIG;
    this.sandbox = opts.sandbox ?? new SandboxRunner(cfg);
    this.timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? console;
  }

  async compile(project: Project): Promise<CompileResult> {
    const started = this.now();
    const job: Job = { id: ++this.seq, ac: new AbortController(), done: false };
    const previous = this.jobs.get(project.id);
    this.jobs.set(project.id, job);
    // Stop the old job and wait until its TeX is dead, so its pkill can't hit our latexmk.
    if (previous && !previous.done) await this.stop(previous, 'superseded');

    let result: CompileResult;
    try {
      result = await this.runWithRetry(project, job, started);
    } catch (e) {
      result = this.fromError(e, project, started);
    } finally {
      job.done = true;
      if (job.timer) clearTimeout(job.timer);
    }
    // Only the current job may update the "latest log" (stale results are dropped).
    if (result.status !== 'CANCELLED' && this.jobs.get(project.id) === job) this.latestLogs.set(project.id, result.log);
    return result;
  }

  async cancel(projectId: string): Promise<void> {
    const job = this.jobs.get(projectId);
    if (job && !job.done) await this.stop(job, 'user');
  }

  getLatestLog(project: Project): LogEntry[] {
    return this.latestLogs.get(project.id) ?? [];
  }

  /** For Step 10: the PDF to show when a project opens, if one was ever built. */
  getLastGoodPdf(projectId: string): string | undefined {
    const p = this.lastGoodPath(projectId);
    return fs.existsSync(p) ? p : undefined;
  }

  lastGoodPath(projectId: string): string {
    return path.join(this.opts.cacheDir, containerName(projectId), 'lastGood.pdf');
  }

  // ---------------------------------------------------------------------------

  /** If the container disappears mid-way, recreate it once (ContainerGoneError), then give up. */
  private async runWithRetry(project: Project, job: Job, started: number): Promise<CompileResult> {
    try {
      return await this.run(project, job, started);
    } catch (e) {
      if (!(e instanceof ContainerGoneError) || job.stopReason) throw e;
      this.log.warn(`[compile] ${e.message} — recreating the container and retrying once.`);
      job.container = undefined;
      try {
        return await this.run(project, job, started);
      } catch (e2) {
        if (e2 instanceof ContainerGoneError) throw new SandboxUnavailableError('The sandbox container keeps disappearing. Restart Docker Desktop.');
        throw e2;
      }
    }
  }

  private async run(project: Project, job: Job, started: number): Promise<CompileResult> {
    const name = await this.sandbox.ensureRunning(project.id, project.rootDir);
    if (job.stopReason) return this.cancelled(project, started);
    job.container = name;

    await this.sandbox.prepareBuildDirs(name);
    if (job.stopReason) return this.cancelled(project, started);

    // C4: the 60 s budget covers the latexmk run (not container start-up).
    job.timer = setTimeout(() => void this.stop(job, 'timeout'), this.timeoutMs);
    let r;
    try {
      r = await this.sandbox.runLatexmk(name, { signal: job.ac.signal, benchmark: this.opts.benchmark });
    } finally {
      clearTimeout(job.timer);
    }
    if (job.killing) await job.killing;

    if (job.stopReason === 'superseded' || job.stopReason === 'user') return this.cancelled(project, started);

    const log = parseLatexLog((await this.sandbox.readLog(name)) ?? '');
    if (this.isStale(project, job)) return this.cancelled(project, started);

    if (job.stopReason === 'timeout') {
      const secs = Math.round(this.timeoutMs / 1000);
      return this.result('TIMEOUT', project, started, [
        { level: 'ERROR', message: `Compilation stopped after ${secs} s (time limit). Check for an infinite loop or a very large document.` },
        ...log,
      ]);
    }

    if (r.code === 0) {
      const pdf = await this.sandbox.copyOut(name, '/build/main.pdf');
      if (this.isStale(project, job)) return this.cancelled(project, started);
      if (!pdf) return this.result('FAILED', project, started, [{ level: 'ERROR', message: 'LaTeX finished but no PDF was produced.' }, ...log]);
      const pdfPath = this.saveLastGood(project.id, pdf);
      return { status: 'SUCCESS', pdfPath, log, durationMs: this.now() - started };
    }

    if (r.code === 137) {
      // Killed, but not by our timer or a cancel → the sandbox limits (C6).
      return this.result('FAILED', project, started, [
        { level: 'ERROR', message: 'Compilation was stopped by the sandbox resource limit (2 GB memory or process limit).' },
        ...log,
      ]);
    }

    // C5: any non-zero exit is FAILED; a partial PDF is ignored and the last good one stays.
    const hasError = log.some((e) => e.level === 'ERROR');
    return this.result('FAILED', project, started, hasError ? log : [
      { level: 'ERROR', message: `Compilation failed (latexmk exit code ${r.code}).${tail(r.stderr)}` },
      ...log,
    ]);
  }

  /** Stop a job: mark why, kill TeX inside the container, free the docker client. Idempotent. */
  private async stop(job: Job, reason: StopReason): Promise<void> {
    if (job.done) return;
    job.stopReason ??= reason;
    if (job.container && !job.killing) {
      job.killing = this.sandbox.killTex(job.container).then(
        () => undefined,
        (e: Error) => this.log.warn(`[compile] killTex failed: ${e.message}`),
      );
    }
    job.ac.abort();
    await job.killing;
  }

  private isStale(project: Project, job: Job): boolean {
    return this.jobs.get(project.id) !== job || job.stopReason === 'superseded' || job.stopReason === 'user';
  }

  /** Write atomically so a viewer never sees half a file. */
  private saveLastGood(projectId: string, pdf: Buffer): string {
    const target = this.lastGoodPath(projectId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, pdf);
    fs.renameSync(tmp, target);
    return target;
  }

  private result(status: CompileStatus, project: Project, started: number, log: LogEntry[]): CompileResult {
    // pdfPath on a non-success = the last good PDF, so the preview can keep it with an "Outdated" banner.
    const pdfPath = this.getLastGoodPdf(project.id);
    return { status, log, durationMs: this.now() - started, ...(pdfPath ? { pdfPath } : {}) };
  }

  private cancelled(project: Project, started: number): CompileResult {
    return this.result('CANCELLED', project, started, []);
  }

  private fromError(e: unknown, project: Project, started: number): CompileResult {
    if (e instanceof SandboxUnavailableError) {
      return this.result('SANDBOX_UNAVAILABLE', project, started, [{ level: 'ERROR', message: e.message }]);
    }
    if (e instanceof ProjectInvalidError) {
      return this.result('FAILED', project, started, [{ level: 'ERROR', message: e.message }]); // C11
    }
    this.log.warn(`[compile] unexpected error: ${(e as Error)?.stack ?? e}`);
    return this.result('FAILED', project, started, [{ level: 'ERROR', message: `Internal error: ${(e as Error)?.message ?? String(e)}` }]);
  }
}

function tail(stderr: string): string {
  const last = stderr.trim().split('\n').filter(Boolean).slice(-1)[0];
  return last ? ` ${last.trim()}` : '';
}
