import { PrivacySettings } from '../privacy/PrivacySettings';
import { Consent } from '../summarization/Consent';
import { formatBytes } from '../summarization/PdfValidator';
import { ConsentDialog, ConsentRequest, SummaryFeedback, SummaryPanel } from './views';

/**
 * Framework-free DOM implementations of the WS-6 boundary classes.
 * Every piece of text is set with textContent (never innerHTML), so a summary
 * or file name can never inject markup into the editor window.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {},
  text?: string
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** CD-3c ConsentDialog — modal, Send / Cancel, Escape counts as close (FR-05.2, FR-05.3). */
export class DomConsentDialog implements ConsentDialog {
  constructor(private readonly doc: Document = document) {}

  public show(request: ConsentRequest): Promise<Consent | null> {
    const doc = this.doc;
    return new Promise((resolve) => {
      const backdrop = el(doc, 'div', { class: 'ws6-backdrop', 'data-testid': 'consent-backdrop' });
      const dialog = el(doc, 'div', {
        class: 'ws6-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'ws6-consent-title',
        'data-testid': 'consent-dialog'
      });

      dialog.append(
        el(doc, 'h2', { id: 'ws6-consent-title' }, 'Send this PDF to a cloud service?'),
        row(doc, 'File', request.fileName, 'consent-file'),
        row(doc, 'Size', formatBytes(request.sizeBytes), 'consent-size'),
        row(doc, 'Provider', request.provider, 'consent-provider'),
        el(doc, 'p', { class: 'ws6-warning', 'data-testid': 'consent-statement' }, request.statement)
      );

      const actions = el(doc, 'div', { class: 'ws6-actions' });
      const cancel = el(doc, 'button', { type: 'button', 'data-testid': 'consent-cancel' }, 'Cancel');
      const send = el(doc, 'button', { type: 'button', 'data-testid': 'consent-send' }, 'Send');
      actions.append(cancel, send);
      dialog.append(actions);
      backdrop.append(dialog);

      let settled = false;
      const finish = (consent: Consent | null) => {
        if (settled) return;
        settled = true;
        doc.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(consent);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(null);
      };

      cancel.addEventListener('click', () => finish(null));
      send.addEventListener('click', () => finish(Consent.grant(request.fileName, request.provider)));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) finish(null); // clicking outside = close
      });
      doc.addEventListener('keydown', onKey);

      doc.body.append(backdrop);
      cancel.focus(); // safe default: Enter does not send
    });
  }
}

function row(doc: Document, label: string, value: string, testId: string): HTMLElement {
  const p = el(doc, 'p', { class: 'ws6-row' });
  p.append(el(doc, 'strong', {}, `${label}: `), el(doc, 'span', { 'data-testid': testId }, value));
  return p;
}

/** CD-3c SummaryPanel — read-only text, no "insert" action (FR-05.5). */
export class DomSummaryPanel implements SummaryPanel {
  constructor(private readonly container: HTMLElement) {}

  public showReadOnly(fileName: string, summary: string): void {
    const doc = this.container.ownerDocument;
    this.container.replaceChildren();
    const heading = el(doc, 'h3', {}, `Summary of ${fileName}`);
    const body = el(doc, 'textarea', {
      readonly: '',
      'aria-readonly': 'true',
      'data-testid': 'summary-text',
      class: 'ws6-summary'
    });
    body.value = summary;
    (body as HTMLTextAreaElement).readOnly = true;
    const note = el(
      doc,
      'p',
      { class: 'ws6-note' },
      'Read-only. This summary is not inserted into any source file. You may copy text manually.'
    );
    this.container.append(heading, body, note);
  }
}

/** Error / Retry / progress area of the AI panel (FR-05.6, FR-05.7). */
export class DomSummaryFeedback implements SummaryFeedback {
  constructor(private readonly container: HTMLElement) {}

  public showProgress(message: string): void {
    const doc = this.container.ownerDocument;
    this.container.replaceChildren(el(doc, 'p', { role: 'status', 'data-testid': 'summary-progress' }, message));
  }

  public clearProgress(): void {
    this.container.replaceChildren();
  }

  public showError(message: string, options: { retry: boolean }): Promise<boolean> {
    const doc = this.container.ownerDocument;
    return new Promise((resolve) => {
      const box = el(doc, 'div', { role: 'alert', class: 'ws6-error', 'data-testid': 'summary-error' });
      box.append(el(doc, 'p', { 'data-testid': 'summary-error-text' }, message));

      const done = (retry: boolean) => {
        box.remove();
        resolve(retry);
      };
      if (options.retry) {
        const retryBtn = el(doc, 'button', { type: 'button', 'data-testid': 'summary-retry' }, 'Retry');
        retryBtn.addEventListener('click', () => done(true));
        box.append(retryBtn);
      }
      const dismiss = el(doc, 'button', { type: 'button', 'data-testid': 'summary-dismiss' }, 'Close');
      dismiss.addEventListener('click', () => done(false));
      box.append(dismiss);

      this.container.replaceChildren(box);
    });
  }
}

/**
 * CD-4a LocalOnlyToggle + LocalOnlyIndicator (FR-06.1, FR-06.5).
 * Mount one toggle on the login screen and one in the main window: both drive
 * the same PrivacySettings instance, so they always agree.
 */
export class DomLocalOnlyToggle {
  private readonly checkbox: HTMLInputElement;
  private readonly unsubscribe: () => void;

  constructor(container: HTMLElement, private readonly settings: PrivacySettings) {
    const doc = container.ownerDocument;
    const label = el(doc, 'label', { class: 'ws6-toggle' });
    this.checkbox = el(doc, 'input', { type: 'checkbox', 'data-testid': 'local-only-toggle' });
    this.checkbox.checked = settings.isLocalOnly();
    this.checkbox.addEventListener('change', () => settings.setLocalOnly(this.checkbox.checked));
    label.append(this.checkbox, el(doc, 'span', {}, ' Local Only mode'));
    container.append(label);
    this.unsubscribe = settings.onChange((on) => {
      this.checkbox.checked = on;
    });
  }

  public dispose(): void {
    this.unsubscribe();
  }
}

export class DomLocalOnlyIndicator {
  private readonly badge: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(container: HTMLElement, settings: PrivacySettings) {
    this.badge = el(container.ownerDocument, 'span', {
      class: 'ws6-local-only-badge',
      role: 'status',
      'data-testid': 'local-only-indicator'
    }, 'Local Only: no external connections');
    container.append(this.badge);
    this.render(settings.isLocalOnly());
    this.unsubscribe = settings.onChange((on) => this.render(on));
  }

  public show(): void {
    this.badge.hidden = false;
  }

  public hide(): void {
    this.badge.hidden = true;
  }

  public dispose(): void {
    this.unsubscribe();
  }

  private render(on: boolean): void {
    if (on) this.show();
    else this.hide();
  }
}
