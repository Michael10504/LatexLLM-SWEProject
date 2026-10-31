import { PrivacySettings } from '../privacy/PrivacySettings';
import { LocalOnlyReader } from '../privacy/PrivacyGuard';
import {
  GatewayTimeoutError,
  InsecureTransportError,
  LocalOnlyBlockedError,
  RequestAbortedByLocalOnlyError
} from './errors';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface GatewayRequestOptions {
  /** Hard time limit for this request, in ms. */
  timeoutMs?: number;
  /** A localhost relay can still cause external traffic (cloud/auth/sync). */
  externalIntent?: boolean;
}

export interface NetworkGatewayOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetchFn?: FetchFn;
  /**
   * Allow plain http:// only to loopback hosts (local dev server without certs).
   * Non-loopback destinations always require https:// (NFR-08).
   */
  allowInsecureLoopback?: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopback(url: string): boolean {
  return LOOPBACK_HOSTS.has(new URL(url).hostname);
}

/**
 * CD-4a NetworkGateway — the single exit point for every external connection
 * (Design Spec 4.1 IF-06, risk SR-02.1; FR-05.4).
 *
 * - While Local Only is on it opens nothing to non-loopback hosts (FR-06.2).
 * - When Local Only is switched on it aborts every in-flight request
 *   synchronously, well within the 1 second limit (FR-06.2, NFR-05).
 * - When switched off it does NOT replay blocked requests (FR-06.6): blocked
 *   calls reject, they are never queued.
 * - Loopback (local LLM on 127.0.0.1) is exempt: local AI keeps working (FR-06.4).
 *
 * Rule for the codebase: no module other than this one may call fetch()
 * directly. Enforce with the ESLint rule in client/eslint.network-rule.json.
 */
export class NetworkGateway {
  /** CD-4a -inFlight : List<Request> (abort registry). */
  private readonly inFlight = new Map<AbortController, string>();
  private readonly abortHandlers = new Map<AbortController, () => void>();
  private readonly fetchFn: FetchFn;
  private readonly allowInsecureLoopback: boolean;
  private externalAllowed: boolean;

  constructor(
    private readonly guard: LocalOnlyReader,
    options: NetworkGatewayOptions = {}
  ) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.allowInsecureLoopback = options.allowInsecureLoopback ?? false;
    this.externalAllowed = !guard.isLocalOnly();
  }

  /** Wire the gateway to settings changes (Figure 11, step 4 / 17). */
  public attach(settings: PrivacySettings): () => void {
    return settings.onChange((on) => this.onLocalOnlyChanged(on));
  }

  public onLocalOnlyChanged(localOnly: boolean): void {
    if (localOnly) {
      this.refuseNewExternalConnections();
      this.abortAll();
    } else {
      this.allowExternalConnections();
    }
  }

  public refuseNewExternalConnections(): void {
    this.externalAllowed = false;
  }

  public allowExternalConnections(): void {
    this.externalAllowed = true;
  }

  /** Number of external requests currently open (used by tests and the indicator). */
  public inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * CD-4a send(): perform one HTTP request through the gateway.
   * Resolves with the Response, or rejects with LocalOnlyBlockedError,
   * RequestAbortedByLocalOnlyError, GatewayTimeoutError, InsecureTransportError
   * or the underlying network error.
   */
  public async send(url: string, init: RequestInit = {}, options: GatewayRequestOptions = {}): Promise<Response> {
    const loopback = isLoopback(url);
    const external = !loopback || options.externalIntent === true;

    // Check BOTH the live guard and our own flag: the guard is the source of
    // truth, the flag covers the window between toggle and notification.
    if (external && (this.guard.isLocalOnly() || !this.externalAllowed)) {
      throw new LocalOnlyBlockedError();
    }

    const protocol = new URL(url).protocol;
    if (protocol !== 'https:' && !(loopback && this.allowInsecureLoopback && protocol === 'http:')) {
      throw new InsecureTransportError(url);
    }

    const controller = new AbortController();
    let abortReason: 'local-only' | 'timeout' | null = null;
    const onLocalOnlyAbort = () => {
      abortReason = 'local-only';
      controller.abort();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        abortReason = 'timeout';
        controller.abort();
      }, options.timeoutMs);
    }

    // Loopback traffic is never aborted by Local Only (FR-06.4).
    if (external) {
      this.inFlight.set(controller, url);
      this.abortHandlers.set(controller, onLocalOnlyAbort);
    }

    // Respect a caller-provided signal too.
    const callerSignal = init.signal;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);
    if (callerSignal?.aborted) controller.abort();

    try {
      const response = await this.fetchFn(url, { ...init, signal: controller.signal, redirect: 'error' });
      // Keep the request registered through body consumption so toggling Local
      // Only cannot leave a download active after headers have arrived.
      if (!external) return response;
      const bytes = await response.arrayBuffer();
      if (abortReason === 'local-only') throw new RequestAbortedByLocalOnlyError();
      if (abortReason === 'timeout') throw new GatewayTimeoutError(options.timeoutMs!);
      return new Response([204, 205, 304].includes(response.status) ? null : bytes,
        { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (abortReason === 'local-only') throw new RequestAbortedByLocalOnlyError();
      if (abortReason === 'timeout') throw new GatewayTimeoutError(options.timeoutMs!);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
      this.inFlight.delete(controller);
      this.abortHandlers.delete(controller);
    }
  }

  /** CD-4a abort(request) for every open external request — synchronous. */
  private abortAll(): void {
    for (const handler of [...this.abortHandlers.values()]) {
      handler();
    }
  }
}
