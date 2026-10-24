import { SandboxRunner } from '../../src/sandbox/SandboxRunner';
import { ContainerGoneError, ProjectInvalidError, SandboxUnavailableError } from '../../src/sandbox/errors';
import { DEFAULT_SANDBOX_CONFIG } from '../../src/types';
import type { DockerResult } from '../../src/sandbox/runDocker';

type Responder = (args: string[]) => Partial<DockerResult> | undefined;

/** Fake docker: records every call; the first responder that returns something wins; default = exit 0. */
function fakeDocker(...responders: Responder[]) {
  const calls: string[][] = [];
  const docker = jest.fn(async (_cfg: unknown, args: string[]) => {
    calls.push(args);
    for (const r of responders) {
      const out = r(args);
      if (out) return { code: 0, stdout: Buffer.alloc(0), stderr: '', ...out };
    }
    return { code: 0, stdout: Buffer.alloc(0), stderr: '' };
  });
  return { docker, calls };
}

const HOST = 'D:/LatexLLM-SWEProject/fixtures/basic';
const quiet = { warn: jest.fn(), debug: jest.fn() };

function runner(docker: ReturnType<typeof fakeDocker>['docker'], resolveDir: (d: string) => string = () => HOST) {
  return new SandboxRunner(DEFAULT_SANDBOX_CONFIG, { docker, resolveDir, sleep: async () => {}, logger: quiet });
}

const isCmd = (args: string[], ...prefix: string[]) => prefix.every((p, i) => args[i] === p);
const noSuchContainer: Responder = (a) =>
  isCmd(a, 'inspect') ? { code: 1, stderr: 'Error: No such object: ltx-x' } : undefined;
const ps = (out: string): Responder => (a) => (a.includes('ps') && a.includes('comm=') ? { stdout: Buffer.from(out) } : undefined);

describe('SandboxRunner.ensureRunning', () => {
  it('creates a fresh container with exactly the fixed docker run command (golden)', async () => {
    const { docker, calls } = fakeDocker(noSuchContainer);
    const r = runner(docker);
    const name = await r.ensureRunning('p1', 'ignored');
    const run = calls.find((a) => a[0] === 'run')!;
    expect(run.join(' ')).toBe(
      `run -d --name ${name} --label app=ltx-sandbox --label ltx.dir=${HOST} --network none --cpus=2 --memory=2g ` +
        `--memory-swap=2g --pids-limit=256 --read-only --cap-drop=ALL --security-opt no-new-privileges --user 1000:1000 ` +
        `-v ${HOST}:/work:ro --tmpfs /build:rw,size=500m,mode=1777 --tmpfs /tmp:rw,size=64m,mode=1777 -w /work ltx-sandbox:1`,
    );
    expect(calls.map((a) => a[0])).toEqual(['version', 'image', 'inspect', 'run']);
  });

  it('reuses a running container whose label matches (warm path)', async () => {
    const { docker, calls } = fakeDocker((a) => (isCmd(a, 'inspect') ? { stdout: Buffer.from(`true|${HOST}\n`) } : undefined));
    await runner(docker).ensureRunning('p1', 'x');
    expect(calls.some((a) => a[0] === 'run' || a[0] === 'rm')).toBe(false);
  });

  it('starts a stopped container whose label matches', async () => {
    const { docker, calls } = fakeDocker((a) => (isCmd(a, 'inspect') ? { stdout: Buffer.from(`false|${HOST}`) } : undefined));
    await runner(docker).ensureRunning('p1', 'x');
    expect(calls.map((a) => a[0])).toEqual(['version', 'image', 'inspect', 'start']);
  });

  it('recreates when the same id now points at a different folder', async () => {
    const { docker, calls } = fakeDocker((a) => (isCmd(a, 'inspect') ? { stdout: Buffer.from('true|D:/other') } : undefined));
    await runner(docker).ensureRunning('p1', 'x');
    expect(calls.map((a) => a[0])).toEqual(['version', 'image', 'inspect', 'rm', 'run']);
  });

  it('checks main.tex before touching Docker (C10)', async () => {
    const { docker } = fakeDocker();
    const r = runner(docker, () => {
      throw new ProjectInvalidError('main.tex not found in the project root.');
    });
    await expect(r.ensureRunning('p1', 'x')).rejects.toBeInstanceOf(ProjectInvalidError);
    expect(docker).not.toHaveBeenCalled();
  });

  it('reports SANDBOX_UNAVAILABLE when the daemon is down', async () => {
    const { docker } = fakeDocker((a) =>
      isCmd(a, 'version') ? { code: 1, stderr: 'error during connect: open //./pipe/docker_engine: The system cannot find the file specified.' } : undefined,
    );
    await expect(runner(docker).ensureRunning('p1', 'x')).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('reports SANDBOX_UNAVAILABLE when the image is missing', async () => {
    const { docker } = fakeDocker((a) => (isCmd(a, 'image') ? { code: 1, stderr: 'Error: No such image: ltx-sandbox:1' } : undefined));
    await expect(runner(docker).ensureRunning('p1', 'x')).rejects.toThrow(/image ltx-sandbox:1 is missing/);
  });

  it('shares one in-flight ensureRunning between concurrent callers', async () => {
    const { docker, calls } = fakeDocker(noSuchContainer);
    const r = runner(docker);
    const [a, b] = await Promise.all([r.ensureRunning('p1', 'x'), r.ensureRunning('p1', 'x')]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c[0] === 'run')).toHaveLength(1);
  });

  it('accepts a name conflict if the container that won is ours', async () => {
    let inspected = 0;
    const { docker } = fakeDocker(
      (a) => (isCmd(a, 'inspect') ? (inspected++ === 0 ? { code: 1, stderr: 'No such object' } : { stdout: Buffer.from(`true|${HOST}`) }) : undefined),
      (a) => (isCmd(a, 'run') ? { code: 125, stderr: 'Conflict. The container name "/ltx-p1" is already in use' } : undefined),
    );
    await expect(runner(docker).ensureRunning('p1', 'x')).resolves.toMatch(/^ltx-p1-/);
  });
});

describe('SandboxRunner exec helpers', () => {
  it('runLatexmk uses the fixed command, -e max_print_line, and -g only for benchmarks', async () => {
    const { docker, calls } = fakeDocker();
    const r = runner(docker);
    await r.runLatexmk('ltx-a');
    await r.runLatexmk('ltx-a', { benchmark: true });
    expect(calls[0].join(' ')).toBe(
      'exec -e max_print_line=10000 ltx-a latexmk -pdf -interaction=nonstopmode -file-line-error -no-shell-escape -outdir=/build main.tex',
    );
    expect(calls[1]).toContain('-g');
    expect(calls[0]).not.toContain('-g');
  });

  it('prepareBuildDirs mirrors subfolders (C8)', async () => {
    const { docker, calls } = fakeDocker();
    await runner(docker).prepareBuildDirs('ltx-a');
    expect(calls[0]).toEqual(['exec', 'ltx-a', 'sh', '-c', 'cd /work && find . -type d -exec mkdir -p /build/{} \;']);
  });

  it('returns non-zero exit codes raw (e.g. 12 for a TeX error)', async () => {
    const { docker } = fakeDocker(() => ({ code: 12 }));
    await expect(runner(docker).runLatexmk('ltx-a')).resolves.toMatchObject({ code: 12 });
  });

  it('throws ContainerGoneError when the container vanished', async () => {
    const { docker } = fakeDocker(() => ({ code: 1, stderr: 'Error response from daemon: No such container: ltx-a' }));
    // docker exec reports a missing container with exit 1 on some versions and 125+ on others; test the 125+ path:
    const { docker: d2 } = fakeDocker(() => ({ code: 125, stderr: 'Error response from daemon: No such container: ltx-a' }));
    await expect(runner(d2).exec('ltx-a', ['true'])).rejects.toBeInstanceOf(ContainerGoneError);
    await expect(runner(docker).exec('ltx-a', ['true'])).resolves.toMatchObject({ code: 1 });
  });

  it('maps a daemon that dies mid-session to SandboxUnavailableError', async () => {
    const { docker } = fakeDocker(() => ({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }));
    await expect(runner(docker).exec('ltx-a', ['true'])).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});

describe('SandboxRunner.copyOut (C9)', () => {
  it('returns the PDF bytes from cat', async () => {
    const pdf = Buffer.from('%PDF-1.5\n\x00\xff binary');
    const { docker, calls } = fakeDocker(() => ({ stdout: pdf }));
    await expect(runner(docker).copyOut('ltx-a', '/build/main.pdf')).resolves.toEqual(pdf);
    expect(calls[0]).toEqual(['exec', 'ltx-a', 'cat', '/build/main.pdf']);
  });
  it('returns null when the file does not exist', async () => {
    const { docker } = fakeDocker(() => ({ code: 1, stderr: 'cat: /build/main.pdf: No such file or directory' }));
    await expect(runner(docker).copyOut('ltx-a', '/build/main.pdf')).resolves.toBeNull();
  });
  it('rejects bytes that are not a PDF', async () => {
    const { docker } = fakeDocker(() => ({ stdout: Buffer.from('garbage') }));
    await expect(runner(docker).copyOut('ltx-a', '/build/main.pdf')).rejects.toThrow(/not a valid PDF/);
  });
  it('refuses paths outside /build without calling docker', async () => {
    const { docker } = fakeDocker();
    await expect(runner(docker).copyOut('ltx-a', '/build/../etc/passwd')).rejects.toBeInstanceOf(ProjectInvalidError);
    expect(docker).not.toHaveBeenCalled();
  });
});

describe('SandboxRunner.killTex', () => {
  it('kills TeX and confirms it is gone', async () => {
    const { docker, calls } = fakeDocker(ps('sleep\nps\n'));
    await expect(runner(docker).killTex('ltx-a')).resolves.toBe('killed');
    expect(calls[0]).toEqual(['exec', 'ltx-a', 'pkill', '-KILL', '-f', 'latexmk|pdflatex|bibtex|biber']);
    expect(calls.some((a) => a[0] === 'restart')).toBe(false);
  });
  it('treats pkill exit 1 (nothing matched) as fine', async () => {
    const { docker } = fakeDocker((a) => (a.includes('pkill') ? { code: 1 } : undefined), ps('sleep\n'));
    await expect(runner(docker).killTex('ltx-a')).resolves.toBe('none');
  });
  it('restarts the container if TeX survives 5 checks (C12)', async () => {
    const { docker, calls } = fakeDocker(ps('sleep\npdflatex\n'));
    await expect(runner(docker).killTex('ltx-a')).resolves.toBe('restarted');
    expect(calls.filter((a) => a.includes('comm='))).toHaveLength(5);
    expect(calls.at(-1)).toEqual(['restart', '-t', '0', 'ltx-a']);
  });
});

describe('SandboxRunner.stop / cleanupOrphans', () => {
  it('stop removes the project container and ignores "No such container"', async () => {
    const { docker, calls } = fakeDocker(() => ({ code: 1, stderr: 'Error: No such container: ltx-p1' }));
    await expect(runner(docker).stop('p1')).resolves.toBeUndefined();
    expect(calls[0].slice(0, 2)).toEqual(['rm', '-f']);
    expect(quiet.warn).not.toHaveBeenCalledWith(expect.stringContaining('No such container'));
  });
  it('removes every labelled container in one rm', async () => {
    const { docker, calls } = fakeDocker((a) => (isCmd(a, 'ps') ? { stdout: Buffer.from('abc123\ndef456\n') } : undefined));
    await expect(runner(docker).cleanupOrphans()).resolves.toBe(2);
    expect(calls[0]).toEqual(['ps', '-aq', '--filter', 'label=app=ltx-sandbox']);
    expect(calls[1]).toEqual(['rm', '-f', 'abc123', 'def456']);
  });
  it('does nothing when there are no orphans', async () => {
    const { docker, calls } = fakeDocker();
    await expect(runner(docker).cleanupOrphans()).resolves.toBe(0);
    expect(calls).toHaveLength(1);
  });
  it('never throws when Docker is off', async () => {
    const { docker } = fakeDocker(() => ({ code: 1, stderr: 'error during connect' }));
    await expect(runner(docker).cleanupOrphans()).resolves.toBe(0);
  });
});
