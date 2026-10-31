import { NetworkGateway, FetchFn } from '../src/network/NetworkGateway';
import { LOCAL_ONLY_MESSAGE, PrivacyGuard } from '../src/privacy/PrivacyGuard';
import { PrivacySettings } from '../src/privacy/PrivacySettings';
import { InMemorySettingsStore } from '../src/privacy/SettingsStore';
import { Consent, THIRD_PARTY_STATEMENT } from '../src/summarization/Consent';
import { PdfValidator } from '../src/summarization/PdfValidator';
import { SummarizationService } from '../src/summarization/SummarizationService';
import { CloudSummarizerAdapter } from '../src/summarization/SummarizerAdapter';
import {
  FakeSession,
  RecordingPanel,
  ScriptedConsentDialog,
  ScriptedFeedback,
  jsonResponse,
  makePdf
} from './helpers';

interface Harness {
  settings: PrivacySettings;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  consent: ScriptedConsentDialog;
  panel: RecordingPanel;
  feedback: ScriptedFeedback;
  session: FakeSession;
  loginRequests: number;
  service: SummarizationService;
}

function harness(opts: {
  localOnly?: boolean;
  consent?: Array<'send' | 'cancel'>;
  retry?: boolean[];
  responses?: Array<Response | Error | 'hang'>;
  token?: string | null;
  timeoutMs?: number;
}): Harness {
  const settings = new PrivacySettings(new InMemorySettingsStore(opts.localOnly ?? false));
  const guard = new PrivacyGuard(settings);
  const fetchCalls: Harness['fetchCalls'] = [];
  const queue = [...(opts.responses ?? [])];
  const fetchFn: FetchFn = (url, init) => {
    fetchCalls.push({ url, init });
    const next = queue.shift() ?? jsonResponse(200, { summary: 'default summary' });
    if (next === 'hang') {
      return new Promise((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      );
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const gateway = new NetworkGateway(guard, { fetchFn });
  gateway.attach(settings);

  const h = {
    settings,
    fetchCalls,
    consent: new ScriptedConsentDialog(opts.consent ?? ['send']),
    panel: new RecordingPanel(),
    feedback: new ScriptedFeedback(opts.retry ?? []),
    session: new FakeSession(opts.token === undefined ? 'session-token' : opts.token),
    loginRequests: 0
  } as Harness;

  h.service = new SummarizationService({
    guard,
    session: h.session,
    validator: new PdfValidator(),
    adapter: new CloudSummarizerAdapter(gateway, {
      serverBaseUrl: 'https://latex.example.edu:3443',
      providerName: 'Acme Summaries',
      timeoutMs: opts.timeoutMs
    }),
    consentDialog: h.consent,
    summaryPanel: h.panel,
    feedback: h.feedback,
    requireLogin: () => {
      h.loginRequests += 1;
    }
  });
  return h;
}

describe('FR-05.1 PDF validation before anything is transmitted', () => {
  const validator = new PdfValidator();

  it('accepts a valid PDF and reports size and page count', async () => {
    const result = await validator.validate(makePdf(12));
    expect(result).toMatchObject({ valid: true, pageCount: 12 });
  });

  it('accepts exactly 100 pages and rejects 101', async () => {
    expect((await validator.validate(makePdf(100))).valid).toBe(true);
    const r = await validator.validate(makePdf(101));
    expect(r.valid).toBe(false);
  });

  it('rejects files over 20 MB', async () => {
    const big = makePdf(1);
    const bytes = new Uint8Array(PdfValidator.MAX_BYTES + 1);
    bytes.set(big.bytes);
    expect((await validator.validate({ name: 'big.pdf', bytes })).valid).toBe(false);
  });

  it('rejects non-PDF content and non-.pdf names', async () => {
    const notPdf = { name: 'fake.pdf', bytes: new Uint8Array(Buffer.from('hello world')) };
    expect((await validator.validate(notPdf)).valid).toBe(false);
    expect((await validator.validate({ ...makePdf(1), name: 'paper.docx' })).valid).toBe(false);
  });

  it('shows an error and transmits nothing for an invalid file', async () => {
    const h = harness({});
    const outcome = await h.service.summarize(makePdf(150));
    expect(outcome.status).toBe('invalid');
    expect(h.consent.shown).toHaveLength(0);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.feedback.errors[0].message).toMatch(/Nothing was transmitted/);
  });
});

describe('FR-05.2 consent dialog per request', () => {
  it('shows file name, size, provider and the third-party statement before sending', async () => {
    const h = harness({});
    await h.service.summarize(makePdf(3, 'thesis.pdf'));
    expect(h.consent.shown).toHaveLength(1);
    expect(h.consent.shown[0]).toMatchObject({
      fileName: 'thesis.pdf',
      provider: 'Acme Summaries',
      statement: THIRD_PARTY_STATEMENT
    });
    expect(h.consent.shown[0].sizeBytes).toBeGreaterThan(0);
  });

  it('a consent can be used for one request only', () => {
    const consent = Consent.grant('a.pdf', 'p');
    consent.consume();
    expect(() => consent.consume()).toThrow();
  });

  it('asks again on every retry (consent is never reused)', async () => {
    const h = harness({
      consent: ['send', 'send'],
      retry: [true],
      responses: [jsonResponse(502, { error: 'down', retryable: true }), jsonResponse(200, { summary: 'S' })]
    });
    const outcome = await h.service.summarize(makePdf(2));
    expect(outcome).toMatchObject({ status: 'shown', attempts: 2 });
    expect(h.consent.shown).toHaveLength(2);
    expect(h.fetchCalls).toHaveLength(2);
  });
});

describe('FR-05.3 cancel or close transmits nothing', () => {
  it('returns cancelled with zero network calls', async () => {
    const h = harness({ consent: ['cancel'] });
    const outcome = await h.service.summarize(makePdf(2));
    expect(outcome.status).toBe('cancelled');
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.panel.shown).toHaveLength(0);
  });
});

describe('FR-05.4 the only cloud path is the gateway to /summarize', () => {
  it('sends one multipart POST to the relay with the session token and consent flag', async () => {
    const h = harness({});
    await h.service.summarize(makePdf(2, 'p.pdf'));
    expect(h.fetchCalls).toHaveLength(1);
    const { url, init } = h.fetchCalls[0];
    expect(url).toBe('https://latex.example.edu:3443/summarize');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
    const form = init?.body as FormData;
    expect(form.get('consent')).toBe('true');
    expect((form.get('pdf') as File).name).toBe('p.pdf');
  });
});

describe('FR-05.5 summary shown read-only, never inserted into source', () => {
  it('passes the summary to the read-only panel only', async () => {
    const h = harness({ responses: [jsonResponse(200, { summary: 'Key findings…', readOnly: true })] });
    const outcome = await h.service.summarize(makePdf(4, 'x.pdf'));
    expect(outcome).toMatchObject({ status: 'shown', summary: 'Key findings…' });
    expect(h.panel.shown).toEqual([{ fileName: 'x.pdf', summary: 'Key findings…' }]);
  });
});

describe('FR-05.6 errors and timeouts offer Retry', () => {
  it.each([
    ['service error (502)', jsonResponse(502, { error: 'x', retryable: true })],
    ['server timeout (504)', jsonResponse(504, { error: 'timeout', retryable: true })],
    ['unreachable', new TypeError('fetch failed')]
  ])('%s -> error with Retry', async (_label, response) => {
    const h = harness({ responses: [response], retry: [false] });
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('failed');
    expect(h.feedback.errors).toHaveLength(1);
    expect(h.feedback.errors[0].retry).toBe(true);
  });

  it('client-side five-minute limit: no answer -> timeout error with Retry', async () => {
    const h = harness({ responses: ['hang'], retry: [false], timeoutMs: 40 });
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('failed');
    expect(h.feedback.errors[0]).toMatchObject({ retry: true });
    expect(h.feedback.errors[0].message).toMatch(/5 minutes/);
  });

  it('defaults to a five-minute limit', () => {
    expect(CloudSummarizerAdapter.TIMEOUT_MS).toBe(300_000);
  });

  it('a 400 validation refusal from the server is not offered for retry', async () => {
    const h = harness({ responses: [jsonResponse(400, { error: 'Invalid file format' })] });
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('failed');
    expect(h.feedback.errors[0].retry).toBe(false);
  });
});

describe('FR-05.7 Local Only blocks summarization without a consent dialog', () => {
  it('blocks at start: error popup, no dialog, nothing transmitted', async () => {
    const h = harness({ localOnly: true });
    const outcome = await h.service.summarize(makePdf(2));
    expect(outcome.status).toBe('blocked-local-only');
    expect(h.feedback.errors[0].message).toBe(LOCAL_ONLY_MESSAGE);
    expect(h.consent.shown).toHaveLength(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('start() blocks before the file picker opens', () => {
    const h = harness({ localOnly: true });
    expect(h.service.start()).toEqual({ status: 'blocked-local-only' });
  });

  it('re-checks before a retry: enabling Local Only between attempts stops the retry', async () => {
    const h = harness({
      consent: ['send', 'send'],
      retry: [true],
      responses: [jsonResponse(502, { error: 'down', retryable: true })]
    });
    // Turn Local Only on while the user is looking at the error.
    const originalShowError = h.feedback.showError.bind(h.feedback);
    h.feedback.showError = async (m, o) => {
      h.settings.setLocalOnly(true);
      return originalShowError(m, o);
    };
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('blocked-local-only');
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.consent.shown).toHaveLength(1);
  });

  it('enabling Local Only mid-request aborts it and reports blocked', async () => {
    const h = harness({ responses: ['hang'] });
    const pending = h.service.summarize(makePdf(1));
    await new Promise((r) => setTimeout(r, 10));
    h.settings.setLocalOnly(true);
    const outcome = await pending;
    expect(outcome.status).toBe('blocked-local-only');
    expect(h.panel.shown).toHaveLength(0);
  });
});

describe('UC-15 authentication precondition', () => {
  it('requires login when there is no session', async () => {
    const h = harness({ token: null });
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('login-required');
    expect(h.loginRequests).toBe(1);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('a 401 from the server sends the user to login without Retry', async () => {
    const h = harness({ responses: [jsonResponse(401, { error: 'expired' })] });
    const outcome = await h.service.summarize(makePdf(1));
    expect(outcome.status).toBe('login-required');
    expect(h.loginRequests).toBe(1);
  });
});
