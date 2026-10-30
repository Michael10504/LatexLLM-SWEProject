import { SessionSource } from '../auth/SessionSource';
import { LOCAL_ONLY_MESSAGE, LocalOnlyReader } from '../privacy/PrivacyGuard';
import { ConsentDialog, SummaryFeedback, SummaryPanel } from '../ui/views';
import { THIRD_PARTY_STATEMENT } from './Consent';
import { PdfFile, PdfValidator } from './PdfValidator';
import { SummarizerAdapter, SummaryFailure } from './SummarizerAdapter';

/** Outcome of one Summarize Paper run (UC-15), for the caller and for tests. */
export type SummarizeOutcome =
  | { status: 'shown'; summary: string; attempts: number }
  | { status: 'blocked-local-only' }
  | { status: 'login-required' }
  | { status: 'invalid'; reason: string }
  | { status: 'cancelled'; attempts: number }
  | { status: 'failed'; reason: string; attempts: number };

export interface SummarizationDeps {
  guard: LocalOnlyReader;
  session: SessionSource;
  validator: PdfValidator;
  adapter: SummarizerAdapter;
  consentDialog: ConsentDialog;
  summaryPanel: SummaryPanel;
  feedback: SummaryFeedback;
  /** Called when the flow needs the login screen (UC-02). */
  requireLogin: () => void;
}

/**
 * CD-3c SummarizationService — implements UC-15 / UC-16 exactly as drawn in
 * Figure 7 (activity) and Figure 16 (sequence):
 *
 *   start()          -> Local Only check, then session check
 *   summarize(file)  -> validate -> loop { Local Only check, consent, send }
 *                       until a summary is shown or the user stops retrying.
 */
export class SummarizationService {
  constructor(private readonly deps: SummarizationDeps) {}

  /**
   * Figure 16 steps 2-10: called when the user clicks "Summarize paper",
   * BEFORE the file picker opens. Returns an outcome when the flow must stop,
   * or null when it is fine to open the file picker.
   */
  public start(): SummarizeOutcome | null {
    if (this.deps.guard.isLocalOnly()) {
      // FR-05.7: error popup, no consent dialog, nothing transmitted.
      void this.deps.feedback.showError(LOCAL_ONLY_MESSAGE, { retry: false });
      return { status: 'blocked-local-only' };
    }
    if (!this.deps.session.hasSession()) {
      this.deps.requireLogin();
      return { status: 'login-required' };
    }
    return null; // OK to open the file picker.
  }

  /** Figure 16 steps 11-41, for the PDF the user selected. */
  public async summarize(file: PdfFile): Promise<SummarizeOutcome> {
    const gate = this.start();
    if (gate) return gate;

    // FR-05.1: validate before anything else; transmit nothing on failure.
    const validation = await this.deps.validator.validate(file);
    if (!validation.valid) {
      await this.deps.feedback.showError(`${validation.reason} Nothing was transmitted.`, { retry: false });
      return { status: 'invalid', reason: validation.reason };
    }

    let attempts = 0;
    // Loop: "until a summary is shown, or the user stops retrying".
    for (;;) {
      // Re-check Local Only before EVERY attempt (Figure 16 step 17).
      if (this.deps.guard.isLocalOnly()) {
        await this.deps.feedback.showError(
          `${LOCAL_ONLY_MESSAGE} Nothing was transmitted for this request.`,
          { retry: false }
        );
        return { status: 'blocked-local-only' };
      }

      // FR-05.2 / UC-16: fresh consent for every request, including retries.
      const consent = await this.deps.consentDialog.show({
        fileName: file.name,
        sizeBytes: validation.sizeBytes,
        provider: this.deps.adapter.providerName,
        statement: THIRD_PARTY_STATEMENT
      });
      if (!consent) {
        // FR-05.3: Cancel or close -> transmit nothing.
        return { status: 'cancelled', attempts };
      }

      const token = this.deps.session.getSessionToken();
      if (!token) {
        this.deps.requireLogin();
        return { status: 'login-required' };
      }

      attempts += 1;
      this.deps.feedback.showProgress('Summarizing paper…');
      try {
        const summary = await this.deps.adapter.summarize(file, consent, token);
        this.deps.feedback.clearProgress();
        // FR-05.5: read-only panel; never inserted into a source file.
        this.deps.summaryPanel.showReadOnly(file.name, summary);
        return { status: 'shown', summary, attempts };
      } catch (error) {
        this.deps.feedback.clearProgress();
        const failure =
          error instanceof SummaryFailure
            ? error
            : new SummaryFailure('unreachable', 'The summarization service is unreachable.', true);

        if (failure.kind === 'auth') {
          this.deps.requireLogin();
          return { status: 'login-required' };
        }
        if (failure.kind === 'blocked') {
          await this.deps.feedback.showError(`${LOCAL_ONLY_MESSAGE}`, { retry: false });
          return { status: 'blocked-local-only' };
        }

        // FR-05.6: error with a Retry option.
        const retry = await this.deps.feedback.showError(failure.message, { retry: failure.retryable });
        if (!retry || !failure.retryable) {
          return { status: 'failed', reason: failure.message, attempts };
        }
        // Retry -> back to the Local Only check and a NEW consent dialog.
      }
    }
  }
}
