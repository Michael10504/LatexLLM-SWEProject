/** Raised when Local Only mode stops a request before anything leaves the device. */
export class LocalOnlyBlockedError extends Error {
  public readonly name = 'LocalOnlyBlockedError';
  constructor(message = 'External connections are blocked while Local Only mode is enabled.') {
    super(message);
  }
}

/** Raised when an in-flight request was aborted because Local Only was switched on. */
export class RequestAbortedByLocalOnlyError extends Error {
  public readonly name = 'RequestAbortedByLocalOnlyError';
  constructor() {
    super('The request was cancelled because Local Only mode was enabled.');
  }
}

/** Raised when a request did not answer within its time limit. */
export class GatewayTimeoutError extends Error {
  public readonly name = 'GatewayTimeoutError';
  constructor(public readonly timeoutMs: number) {
    super(`No response within ${Math.round(timeoutMs / 1000)} seconds.`);
  }
}

/** Raised when a caller tries to reach a non-loopback host without TLS (NFR-08). */
export class InsecureTransportError extends Error {
  public readonly name = 'InsecureTransportError';
  constructor(url: string) {
    super(`Refusing to send data without TLS: ${new URL(url).host}`);
  }
}
