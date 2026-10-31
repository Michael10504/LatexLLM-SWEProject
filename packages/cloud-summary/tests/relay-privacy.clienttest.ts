import { NetworkGateway } from '../src/network/NetworkGateway';
import { PrivacySettings } from '../src/privacy/PrivacySettings';
import { InMemorySettingsStore } from '../src/privacy/SettingsStore';
import { PrivacyGuard } from '../src/privacy/PrivacyGuard';
import { LocalOnlyBlockedError, RequestAbortedByLocalOnlyError } from '../src/network/errors';

test('Local Only blocks a cloud relay even when the server is on localhost', async () => {
    const settings = new PrivacySettings(new InMemorySettingsStore(true));
    const fetchFn = jest.fn(async () => new Response('unexpected'));
    const gateway = new NetworkGateway(new PrivacyGuard(settings), { fetchFn, allowInsecureLoopback: true });
    await expect(gateway.send('http://127.0.0.1:3443/summarize', {}, { externalIntent: true }))
        .rejects.toBeInstanceOf(LocalOnlyBlockedError);
    expect(fetchFn).not.toHaveBeenCalled();
});

test('enabling Local Only aborts a localhost relay whose response headers already arrived', async () => {
    const settings = new PrivacySettings(new InMemorySettingsStore(false));
    let headersReceived!: () => void;
    const ready = new Promise<void>(resolve => { headersReceived = resolve; });
    const gateway = new NetworkGateway(new PrivacyGuard(settings), { allowInsecureLoopback: true,
        fetchFn: async (_url, init) => new Response(new ReadableStream({ start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
            headersReceived();
        } })) });
    gateway.attach(settings);
    const pending = gateway.send('http://127.0.0.1:3443/summarize', {}, { externalIntent: true });
    await ready;
    expect(gateway.inFlightCount()).toBe(1);
    settings.setLocalOnly(true);
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedByLocalOnlyError);
    expect(gateway.inFlightCount()).toBe(0);
});
