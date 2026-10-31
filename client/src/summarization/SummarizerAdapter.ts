import { NetworkGateway } from '../network/NetworkGateway';
import { GatewayTimeoutError, LocalOnlyBlockedError, RequestAbortedByLocalOnlyError } from '../network/errors';
import { Consent } from './Consent';
import { PdfFile } from './PdfValidator';

export type SummaryFailureKind = 'timeout' | 'unreachable' | 'service-error' | 'blocked' | 'auth';

/** Every failure from the cloud path, already sorted into what the UI needs. */
export class SummaryFailure extends Error {
  public readonly name = 'SummaryFailure';
  constructor(
    public readonly kind: SummaryFailureKind,
    message: string,
    /** FR-05.6: timeouts, unreachable and service errors offer Retry. */
    public readonly retryable: boolean
  ) {
    super(message);
  }
}

/** CD-3c «interface» SummarizerAdapter */
export interface SummarizerAdapter {
  /** Human-readable provider name shown in the consent dialog (FR-05.2). */
  readonly providerName: string;
  summarize(pdf: PdfFile, consent: Consent, sessionToken: string): Promise<string>;
}

export interface CloudSummarizerAdapterOptions {
  /** Project server base URL, e.g. https://latex.example.edu:3443 */
  serverBaseUrl: string;
  /** Provider id understood by the server's CredentialStore. */
  providerId?: string;
  /** Display name for the consent dialog. */
  providerName?: string;
  /** FR-05.6 time limit; defaults to 60 s. */
  timeoutMs?: number;
}

/**
 * CD-3c CloudSummarizerAdapter.
 *
 * Sends the PDF to the project server's stateless relay (POST /summarize,
 * implemented by WS-1 in src/controllers/SummarizationController.ts), which
 * holds the provider key and stores nothing (FR-05.8). The client never sees
 * the API key (NFR-08). All traffic goes through NetworkGateway (FR-05.4).
 */
export class CloudSummarizerAdapter implements SummarizerAdapter {
  public static readonly TIMEOUT_MS = 60 * 1000;
  public readonly providerName: string;
  private readonly providerId: string;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(
    private readonly gateway: NetworkGateway,
    options: CloudSummarizerAdapterOptions
  ) {
    this.providerId = options.providerId ?? 'default-cloud-provider';
    this.providerName = options.providerName ?? 'Google Gemini';
    this.timeoutMs = options.timeoutMs ?? CloudSummarizerAdapter.TIMEOUT_MS;
    this.endpoint = new URL('/summarize', options.serverBaseUrl).toString();
  }

  public async summarize(pdf: PdfFile, consent: Consent, sessionToken: string): Promise<string> {
    // Throws if this consent was already used: consent covers one request only.
    consent.consume();

    // Matches the server's multer field name ('pdf') and its consent/provider fields.
    const form = new FormData();
    form.append('pdf', new Blob([new Uint8Array(pdf.bytes)], { type: 'application/pdf' }), pdf.name);
    form.append('consent', 'true');
    form.append('provider', this.providerId);

    let response: Response;
    try {
      response = await this.gateway.send(
        this.endpoint,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
          body: form
        },
        { timeoutMs: this.timeoutMs }
      );
    } catch (error) {
      throw toFailure(error);
    }

    if (response.status === 401) {
      throw new SummaryFailure('auth', 'Your session has expired. Please log in again.', false);
    }

    let data: { summary?: string; error?: string; retryable?: boolean } = {};
    try {
      data = (await response.json()) as typeof data;
    } catch {
      // Non-JSON body: treated as a service error below.
    }

    if (response.status === 504) {
      throw new SummaryFailure('timeout', 'The summarization service did not answer within 60 seconds.', true);
    }
    if (!response.ok) {
      // 400 is a validation refusal from the server: retrying the same file will not help.
      const retryable = response.status >= 500 || data.retryable === true;
      throw new SummaryFailure(
        'service-error',
        data.error ?? `The summarization service returned an error (HTTP ${response.status}).`,
        retryable
      );
    }
    if (!data.summary || typeof data.summary !== 'string') {
      throw new SummaryFailure('service-error', 'The summarization service returned an empty summary.', true);
    }
    return data.summary;
  }
}

function toFailure(error: unknown): SummaryFailure {
  if (error instanceof SummaryFailure) return error;
  if (error instanceof LocalOnlyBlockedError || error instanceof RequestAbortedByLocalOnlyError) {
    return new SummaryFailure('blocked', error.message, false);
  }
  if (error instanceof GatewayTimeoutError) {
    return new SummaryFailure('timeout', 'The summarization service did not answer within 60 seconds.', true);
  }
  return new SummaryFailure('unreachable', 'The summarization service is unreachable.', true);
}
