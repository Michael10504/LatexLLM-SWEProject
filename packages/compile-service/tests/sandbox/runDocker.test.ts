import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
import { spawn } from 'node:child_process';
import { isDaemonDown, runDocker } from '../../src/sandbox/runDocker';
import { SandboxUnavailableError } from '../../src/sandbox/errors';
import { DEFAULT_SANDBOX_CONFIG } from '../../src/types';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: jest.Mock };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn(() => setImmediate(() => child.emit('close', null, 'SIGTERM')));
  return child;
}

describe('runDocker', () => {
  beforeEach(() => (spawn as jest.Mock).mockReset());

  it('spawns docker with an argument array and no shell', async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);
    const p = runDocker(DEFAULT_SANDBOX_CONFIG, ['exec', 'ltx-a', 'cat', '/build/main.pdf']);
    child.stdout.write(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));
    child.stderr.write('warn');
    setImmediate(() => child.emit('close', 0, null));
    const r = await p;
    expect(spawn).toHaveBeenCalledWith('docker', ['exec', 'ltx-a', 'cat', '/build/main.pdf'], { shell: false, windowsHide: true });
    expect(r.code).toBe(0);
    expect([...r.stdout]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]); // binary-safe
    expect(r.stderr).toBe('warn');
  });

  it('maps ENOENT (docker not installed) to SandboxUnavailableError', async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);
    const p = runDocker(DEFAULT_SANDBOX_CONFIG, ['version']);
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })));
    await expect(p).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('kills the client on timeout and reports 137', async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);
    const r = await runDocker(DEFAULT_SANDBOX_CONFIG, ['exec', 'x', 'sleep', '100'], { timeoutMs: 10 });
    expect(child.kill).toHaveBeenCalled();
    expect(r.code).toBe(137);
    expect(r.timedOut).toBe(true);
  });

  it('does not flag timedOut on a normal exit', async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);
    const p = runDocker(DEFAULT_SANDBOX_CONFIG, ['version'], { timeoutMs: 5000 });
    setImmediate(() => child.emit('close', 0, null));
    expect((await p).timedOut).toBeUndefined();
  });

  it('kills the client when aborted', async () => {
    const child = fakeChild();
    (spawn as jest.Mock).mockReturnValue(child);
    const ac = new AbortController();
    const p = runDocker(DEFAULT_SANDBOX_CONFIG, ['exec', 'x', 'latexmk'], { signal: ac.signal });
    ac.abort();
    await p;
    expect(child.kill).toHaveBeenCalled();
  });
});

describe('isDaemonDown', () => {
  it.each([
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'error during connect: Get "http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.47/version": open //./pipe/docker_engine: The system cannot find the file specified.',
  ])('detects %s', (s) => expect(isDaemonDown(s)).toBe(true));
  it('ignores ordinary errors', () => expect(isDaemonDown('Error: No such container: x')).toBe(false));
});
