import type { SandboxConfig } from '../types';
import { DEFAULT_SANDBOX_CONFIG } from '../types';
import { ContainerGoneError, ProjectInvalidError, SandboxUnavailableError } from './errors';
import { assertBuildPath, containerName, resolveProjectDir } from './paths';
import { DockerResult, isDaemonDown, RunOpts, runDocker } from './runDocker';

export type DockerFn = (cfg: SandboxConfig, args: string[], opts?: RunOpts) => Promise<DockerResult>;

export interface SandboxRunnerDeps {
  docker?: DockerFn;
  sleep?: (ms: number) => Promise<void>;
  /** Override for tests; defaults to resolveProjectDir (checks main.tex, converts Windows paths). */
  resolveDir?: (dir: string) => string;
  logger?: Pick<Console, 'warn' | 'debug'>;
}

export interface ExecOpts extends RunOpts {
  env?: Record<string, string>;
}

const TEX_PATTERN = 'latexmk|pdflatex|bibtex|biber';
const TEX_RE = /latexmk|pdflatex|bibtex|biber/;
const NO_SUCH = /No such (object|container)/i;
/** Safety limit for small docker commands. Generous: a busy Docker Desktop can take >15 s just to start an exec. */
const QUICK = { timeoutMs: 30_000 };

/**
 * C8: mirror the project's subfolders into /build. String.raw keeps the backslash, so sh hands
 * `\;` to find. (A plain '\;' in TS is just ';', which ends the command and makes find fail.)
 */
export const MIRROR_DIRS_CMD = String.raw`cd /work && find . -type d -exec mkdir -p /build/{} \;`;

/** Short reason for a failed docker call, for warnings. */
function describe(r: DockerResult): string {
  if (r.timedOut) return `no answer from Docker within ${QUICK.timeoutMs / 1000} s; Docker Desktop may be overloaded`;
  return `exit ${r.code}${r.stderr.trim() ? `: ${r.stderr.trim()}` : ''}`;
}

/**
 * `ps -eo stat=,comm=` output → is any TeX process still running?
 * Zombies (stat Z) are ignored: after latexmk is killed, pdflatex is re-parented to PID 1
 * (`sleep infinity`), which never reaps it, so it lingers as <defunct> but uses no CPU.
 */
export function texAlive(psOutput: string): boolean {
  return psOutput.split('\n').some((line) => {
    const [stat = '', ...rest] = line.trim().split(/\s+/);
    return !stat.startsWith('Z') && TEX_RE.test(rest.join(' '));
  });
}

/**
 * The only class that talks to Docker. Wraps the fixed sandbox commands from the WS-3 handoff.
 * No compile logic and no 60 s timer here — that is CompileService (Step 6).
 */
export class SandboxRunner {
  private readonly docker: DockerFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly resolveDir: (dir: string) => string;
  private readonly log: Pick<Console, 'warn' | 'debug'>;
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly cfg: SandboxConfig = DEFAULT_SANDBOX_CONFIG,
    deps: SandboxRunnerDeps = {},
  ) {
    this.docker = deps.docker ?? runDocker;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.resolveDir = deps.resolveDir ?? ((d) => resolveProjectDir(d));
    this.log = deps.logger ?? console;
  }

  containerName(projectId: string): string {
    return containerName(projectId);
  }

  /** Exact `docker run` arguments (the fixed command + the ltx.dir label, decision B6). Exposed for the golden test. */
  buildRunArgs(name: string, hostDir: string): string[] {
    const c = this.cfg;
    return [
      'run', '-d',
      '--name', name,
      '--label', c.label,
      '--label', `ltx.dir=${hostDir}`,
      '--network', 'none',
      `--cpus=${c.cpus}`,
      `--memory=${c.memory}`,
      `--memory-swap=${c.memory}`,
      `--pids-limit=${c.pidsLimit}`,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt', 'no-new-privileges',
      '--user', c.user,
      '-v', `${hostDir}:/work:ro`,
      '--tmpfs', `/build:rw,size=${c.buildTmpfs},mode=1777`,
      '--tmpfs', `/tmp:rw,size=${c.tmpTmpfs},mode=1777`,
      '-w', '/work',
      c.image,
    ];
  }

  /** Start (or reuse) the warm container for this project. Returns the container name. */
  ensureRunning(projectId: string, projectDir: string): Promise<string> {
    const existing = this.pending.get(projectId);
    if (existing) return existing;
    const p = this.doEnsureRunning(projectId, projectDir).finally(() => this.pending.delete(projectId));
    this.pending.set(projectId, p);
    return p;
  }

  private async doEnsureRunning(projectId: string, projectDir: string): Promise<string> {
    const hostDir = this.resolveDir(projectDir); // C10 — throws before Docker is touched
    const name = containerName(projectId);

    await this.checkDaemon();
    await this.checkImage();

    const state = await this.inspect(name);
    if (state) {
      if (state.dir === hostDir) {
        if (state.running) return name; // warm path
        const r = await this.call(['start', name], QUICK);
        if (r.code === 0) return name;
        this.log.warn(`[sandbox] docker start ${name} failed, recreating: ${r.stderr.trim()}`);
      }
      await this.call(['rm', '-f', name], QUICK);
    }
    return this.create(name, hostDir);
  }

  private async create(name: string, hostDir: string): Promise<string> {
    const r = await this.call(this.buildRunArgs(name, hostDir), { timeoutMs: 60_000 });
    if (r.code === 0) return name;
    if (/Conflict|already in use/i.test(r.stderr)) {
      // Another caller created it first; accept it if it is ours and running.
      const s = await this.inspect(name);
      if (s?.running && s.dir === hostDir) return name;
    }
    throw new SandboxUnavailableError(`Could not start sandbox container: ${r.stderr.trim() || `exit ${r.code}`}`);
  }

  private async checkDaemon(): Promise<void> {
    const r = await this.call(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 5_000 });
    if (r.code !== 0) throw new SandboxUnavailableError('Docker Desktop is not running. Start it and compile again.');
  }

  private async checkImage(): Promise<void> {
    const r = await this.call(['image', 'inspect', '--format', '{{.Id}}', this.cfg.image], QUICK);
    if (r.code !== 0) {
      throw new SandboxUnavailableError(`Sandbox image ${this.cfg.image} is missing. Build it from packages/compile-service/docker.`);
    }
  }

  private async inspect(name: string): Promise<{ running: boolean; dir: string } | null> {
    const r = await this.call(['inspect', '-f', '{{.State.Running}}|{{index .Config.Labels "ltx.dir"}}', name], QUICK);
    if (r.code !== 0) {
      if (NO_SUCH.test(r.stderr)) return null;
      throw new SandboxUnavailableError(`docker inspect failed: ${r.stderr.trim()}`);
    }
    const [running, dir = ''] = r.stdout.toString('utf8').trim().split('|');
    return { running: running === 'true', dir };
  }

  /** Full `docker inspect` JSON of a container (Step 14 checklist). */
  async inspectJson(name: string): Promise<Record<string, unknown>> {
    const r = await this.call(['inspect', name], QUICK);
    if (r.code !== 0) throw new SandboxUnavailableError(`docker inspect ${name} failed: ${r.stderr.trim()}`);
    const parsed = JSON.parse(r.stdout.toString('utf8')) as Record<string, unknown>[];
    return parsed[0];
  }

  /** `docker exec [-e K=V] <name> ...cmd`. Exit codes are returned raw; CompileService interprets them. */
  async exec(name: string, cmd: string[], opts: ExecOpts = {}): Promise<DockerResult> {
    const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const r = await this.call(['exec', ...envArgs, name, ...cmd], opts);
    if (r.code >= 125 && r.code <= 127 && /No such container|is not running|is restarting/i.test(r.stderr)) {
      throw new ContainerGoneError(r.stderr);
    }
    return r;
  }

  /** C8: mirror the project's subfolders into /build so \include of subfolder files works on pass 1. */
  async prepareBuildDirs(name: string): Promise<DockerResult> {
    const r = await this.exec(name, ['sh', '-c', MIRROR_DIRS_CMD], QUICK);
    if (r.code !== 0) {
      // Not fatal: latexmk can recover, but only with an extra (slow) pdflatex pass.
      this.log.warn(`[sandbox] mirroring subfolders into /build failed (${describe(r)}); \\include of subfolder files will need an extra pass.`);
    }
    return r;
  }

  /** The fixed latexmk command. `benchmark` adds -g (force) for NFR-03 runs only. */
  runLatexmk(name: string, opts: { benchmark?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DockerResult> {
    const cmd = [
      'latexmk', '-pdf', '-interaction=nonstopmode', '-file-line-error', '-no-shell-escape', '-outdir=/build',
      ...(opts.benchmark ? ['-g'] : []),
      'main.tex',
    ];
    return this.exec(name, cmd, {
      env: { max_print_line: '10000' },
      signal: opts.signal,
      // Client-side backstop only; the real 60 s timer is in CompileService.
      timeoutMs: opts.timeoutMs ?? this.cfg.timeoutMs + 30_000,
    });
  }

  /** C9: docker cp cannot read tmpfs, so stream `cat` into a Buffer. Returns null if the file doesn't exist. */
  async copyOut(name: string, containerPath: string): Promise<Buffer | null> {
    assertBuildPath(containerPath);
    const r = await this.exec(name, ['cat', containerPath], { timeoutMs: 30_000 });
    if (r.code !== 0) return null;
    if (containerPath.endsWith('.pdf') && r.stdout.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error(`Copied ${containerPath} is not a valid PDF (${r.stdout.length} bytes).`);
    }
    return r.stdout;
  }

  readLog(name: string): Promise<Buffer | null> {
    return this.copyOut(name, '/build/main.log');
  }

  /**
   * Kill TeX inside the container and confirm it is gone. If it survives, restart the
   * container (wipes /build — decision C12). Returns what it had to do.
   */
  async killTex(name: string): Promise<'killed' | 'none' | 'restarted'> {
    const k = await this.exec(name, ['pkill', '-KILL', '-f', TEX_PATTERN], QUICK);
    if (k.code !== 0 && k.code !== 1) this.log.warn(`[sandbox] pkill did not complete (${describe(k)}); checking with ps.`);

    for (let i = 0; i < 5; i++) {
      const ps = await this.exec(name, ['ps', '-eo', 'stat=,comm='], QUICK);
      const alive = texAlive(ps.stdout.toString('utf8'));
      if (!alive) return k.code === 0 ? 'killed' : 'none';
      await this.sleep(200);
    }

    this.log.warn(`[sandbox] TeX survived pkill in ${name}; restarting container (/build is wiped).`);
    const r = await this.call(['restart', '-t', '0', name], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new SandboxUnavailableError(`Could not restart ${name}: ${r.stderr.trim()}`);
    return 'restarted';
  }

  /** Remove this project's container (tmpfs contents go with it). */
  async stop(projectId: string): Promise<void> {
    const name = containerName(projectId);
    const r = await this.call(['rm', '-f', name], QUICK).catch(() => null);
    if (r && r.code !== 0 && !NO_SUCH.test(r.stderr)) this.log.warn(`[sandbox] rm ${name}: ${r.stderr.trim()}`);
  }

  /** On app start: remove every container with our label. Never throws (Docker may be off). Returns the count removed. */
  async cleanupOrphans(): Promise<number> {
    try {
      const ps = await this.call(['ps', '-aq', '--filter', `label=${this.cfg.label}`], QUICK);
      if (ps.code !== 0) return 0;
      const ids = ps.stdout.toString('utf8').split(/\s+/).filter(Boolean);
      if (ids.length === 0) return 0;
      const rm = await this.call(['rm', '-f', ...ids], { timeoutMs: 60_000 });
      return rm.code === 0 ? ids.length : 0;
    } catch (e) {
      this.log.warn(`[sandbox] cleanupOrphans skipped: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Every docker call: map daemon-down to SandboxUnavailableError. */
  private async call(args: string[], opts?: RunOpts): Promise<DockerResult> {
    this.log.debug?.(`[sandbox] docker ${args.join(' ')}`);
    const r = await this.docker(this.cfg, args, opts);
    if (r.code !== 0 && isDaemonDown(r.stderr)) {
      throw new SandboxUnavailableError('Docker Desktop is not running. Start it and compile again.');
    }
    return r;
  }
}

export { ProjectInvalidError, SandboxUnavailableError, ContainerGoneError };
