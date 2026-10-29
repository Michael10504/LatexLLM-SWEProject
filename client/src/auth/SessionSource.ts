/**
 * The slice of WS-1's client-side AuthClient (CD-4b) that WS-6 needs.
 * AuthClient implements this; tests use a fake.
 */
export interface SessionSource {
  hasSession(): boolean;
  /** The bearer token for the project server, or null when logged out. */
  getSessionToken(): string | null;
}
