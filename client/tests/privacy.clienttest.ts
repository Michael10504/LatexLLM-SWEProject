import fs from 'fs';
import os from 'os';
import path from 'path';
import { NetworkGateway } from '../src/network/NetworkGateway';
import {
  InsecureTransportError,
  LocalOnlyBlockedError,
  RequestAbortedByLocalOnlyError,
  GatewayTimeoutError
} from '../src/network/errors';
import { PrivacyGuard } from '../src/privacy/PrivacyGuard';
import { PrivacySettings } from '../src/privacy/PrivacySettings';
import { FileSettingsStore, InMemorySettingsStore } from '../src/privacy/SettingsStore';

/** A fetch that never resolves until aborted — models a slow external request. */
function hangingFetch() {
  const calls: string[] = [];
  const fn = (url: string, init?: RequestInit) => {
    calls.push(url);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  return { fn, calls };
}

function setup(localOnly = false) {
  const settings = new PrivacySettings(new InMemorySettingsStore(localOnly));
  const guard = new PrivacyGuard(settings);
  const http = hangingFetch();
  const gateway = new NetworkGateway(guard, { fetchFn: http.fn, allowInsecureLoopback: true });
  gateway.attach(settings);
  return { settings, guard, gateway, http };
}

describe('FR-06.1 global Local Only setting', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws6-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('defaults to off when no settings file exists', () => {
    const settings = new PrivacySettings(new FileSettingsStore(path.join(dir, 'settings.json')));
    expect(settings.isLocalOnly()).toBe(false);
  });

  it('persists across restarts (new instance reads the saved value)', () => {
    const file = path.join(dir, 'nested', 'settings.json');
    new PrivacySettings(new FileSettingsStore(file)).setLocalOnly(true);
    const afterRestart = new PrivacySettings(new FileSettingsStore(file));
    expect(afterRestart.isLocalOnly()).toBe(true);
  });

  it('falls back to off when the settings file is corrupt', () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ not json');
    expect(new PrivacySettings(new FileSettingsStore(file)).isLocalOnly()).toBe(false);
  });

  it('is one global value: every reader (login screen, main window, guard) sees the same state', () => {
    const settings = new PrivacySettings(new InMemorySettingsStore());
    const guardA = new PrivacyGuard(settings);
    const guardB = new PrivacyGuard(settings);
    const seen: boolean[] = [];
    settings.onChange((on) => seen.push(on));

    settings.setLocalOnly(true);
    expect(guardA.isLocalOnly()).toBe(true);
    expect(guardB.isLocalOnly()).toBe(true);
    settings.setLocalOnly(true); // no-op: no duplicate notification
    settings.setLocalOnly(false);
    expect(seen).toEqual([true, false]);
  });
});

describe('FR-05.4 / FR-06.2 NetworkGateway is the single, guarded exit point', () => {
  it('refuses external requests while Local Only is on and never calls fetch', async () => {
    const { gateway, http } = setup(true);
    await expect(gateway.send('https://api.example.com/x')).rejects.toBeInstanceOf(LocalOnlyBlockedError);
    expect(http.calls).toHaveLength(0);
  });

  it('still allows loopback (local LLM) while Local Only is on (FR-06.4)', async () => {
    const settings = new PrivacySettings(new InMemorySettingsStore(true));
    const ok = jest.fn(async () => new Response('ok'));
    const gateway = new NetworkGateway(new PrivacyGuard(settings), { fetchFn: ok, allowInsecureLoopback: true });
    const res = await gateway.send('http://127.0.0.1:8080/v1/chat/completions');
    expect(await res.text()).toBe('ok');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight external requests within 1 second of enabling Local Only', async () => {
    const { settings, gateway } = setup(false);
    const pending = gateway.send('https://api.example.com/slow');
    expect(gateway.inFlightCount()).toBe(1);

    const start = Date.now();
    settings.setLocalOnly(true);
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedByLocalOnlyError);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(gateway.inFlightCount()).toBe(0);
  });

  it('does not replay blocked requests after Local Only is disabled (FR-06.6)', async () => {
    const { settings, gateway, http } = setup(true);
    await expect(gateway.send('https://api.example.com/x')).rejects.toBeInstanceOf(LocalOnlyBlockedError);
    settings.setLocalOnly(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(http.calls).toHaveLength(0);
  });

  it('requires TLS for non-loopback hosts (NFR-08)', async () => {
    const { gateway, http } = setup(false);
    await expect(gateway.send('http://api.example.com/x')).rejects.toBeInstanceOf(InsecureTransportError);
    expect(http.calls).toHaveLength(0);
  });

  it('reports a timeout distinctly from other failures', async () => {
    const { gateway } = setup(false);
    await expect(gateway.send('https://api.example.com/slow', {}, { timeoutMs: 30 })).rejects.toBeInstanceOf(
      GatewayTimeoutError
    );
  });
});
