import { spawn } from 'node:child_process';
import type { SandboxConfig } from '../types';
import { SandboxUnavailableError } from './errors';

export interface DockerResult {
  /** Process exit code. A client killed by a signal reports 137. */
  code: number;
  /** Raw stdout. Binary-safe (used for `cat /build/main.pdf`). */
  stdout: Buffer;
  stderr: string;
}

export interface RunOpts {
  /** Safety timeout for the docker client process (not the 60 s compile timer, which lives in CompileService). */
  timeoutMs?: number;
  /** Kill the client if stdout grows past this (default 200 MB). */
  maxStdoutBytes?: number;
  /** Aborting kills the local docker client only. Use SandboxRunner.killTex to stop TeX inside the container. */
  signal?: AbortSignal;
}

const DAEMON_DOWN = [
  /Cannot connect to the Docker daemon/i,
  /error during connect/i,
  /The system cannot find the file specified/i, // Windows named pipe when Docker Desktop is off
  /docker daemon is not running/i,
  /Is the docker daemon running/i,
];

export function isDaemonDown(stderr: string): boolean {
  return DAEMON_DOWN.some((re) => re.test(stderr));
}

/**
 * The only place that spawns docker. Argument array + shell:false, so paths with spaces
 * and Go templates need no quoting, and nothing can be injected through a project name.
 */
export function runDocker(cfg: SandboxConfig, args: string[], opts: RunOpts = {}): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    if (opts.signal?.aborted) {
      reject(new Error('Aborted before start'));
      return;
    }

    const child = spawn(cfg.dockerPath, args, { shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    const max = opts.maxStdoutBytes ?? 200 * 1024 * 1024;

    child.stdout?.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) child.kill();
      else chunks.push(c);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (s: string) => {
      stderr += s;
    });

    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined;
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (e: NodeJS.ErrnoException) => {
      finish(() =>
        reject(e.code === 'ENOENT' ? new SandboxUnavailableError('Docker CLI not found on PATH. Install Docker Desktop.') : e),
      );
    });
    child.on('close', (code, signal) => {
      finish(() => resolve({ code: code ?? (signal ? 137 : -1), stdout: Buffer.concat(chunks), stderr }));
    });
  });
}
