import { PrivacySettings } from './PrivacySettings';

/**
 * CD-4a PrivacyGuard — read-only view of the Local Only flag.
 *
 * Feature code (SummarizationService, AuthClient, SharingClient, SyncService)
 * asks the guard, never PrivacySettings directly, so no feature can flip the
 * setting by accident. This is the "stub" WS-6 owes the other tracks: they can
 * depend on this interface now; WS-6 owns the full IF-06 behaviour.
 */
export interface LocalOnlyReader {
  isLocalOnly(): boolean;
}

export class PrivacyGuard implements LocalOnlyReader {
  constructor(private readonly settings: PrivacySettings) {}

  public isLocalOnly(): boolean {
    return this.settings.isLocalOnly();
  }
}

/** The message every blocked online function shows (FR-06.3, FR-05.7). */
export const LOCAL_ONLY_MESSAGE =
  'This function is unavailable in Local Only mode. Disable Local Only mode first.';
