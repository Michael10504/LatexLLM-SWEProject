import { Consent } from '../summarization/Consent';

/** What the consent dialog must show (FR-05.2). */
export interface ConsentRequest {
  fileName: string;
  sizeBytes: number;
  provider: string;
  statement: string;
}

/**
 * CD-3c «boundary» ConsentDialog.
 * Resolves with a fresh Consent when the user clicks Send, or null when the
 * user clicks Cancel or closes the dialog (FR-05.3).
 */
export interface ConsentDialog {
  show(request: ConsentRequest): Promise<Consent | null>;
}

/** CD-3c «boundary» SummaryPanel — read-only (FR-05.5). */
export interface SummaryPanel {
  showReadOnly(fileName: string, summary: string): void;
}

/**
 * The parts of CD-3a «boundary» AIPanel that the summarization flow uses.
 * showError resolves true when the user chooses Retry (FR-05.6).
 */
export interface SummaryFeedback {
  showError(message: string, options: { retry: boolean }): Promise<boolean>;
  showProgress(message: string): void;
  clearProgress(): void;
}
