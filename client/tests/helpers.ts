import { SessionSource } from '../src/auth/SessionSource';
import { Consent } from '../src/summarization/Consent';
import { PdfFile } from '../src/summarization/PdfValidator';
import { ConsentDialog, ConsentRequest, SummaryFeedback, SummaryPanel } from '../src/ui/views';

/** Builds a tiny but structurally valid PDF with `pages` pages. */
export function makePdf(pages: number, name = 'paper.pdf'): PdfFile {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ');
  let body = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n';
  body += `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj\n`;
  for (let i = 0; i < pages; i++) {
    body += `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`;
  }
  body += 'trailer << /Root 1 0 R >>\n%%EOF\n';
  return { name, bytes: new Uint8Array(Buffer.from(body, 'latin1')) };
}

export class FakeSession implements SessionSource {
  constructor(public token: string | null = 'session-token') {}
  hasSession(): boolean {
    return this.token !== null;
  }
  getSessionToken(): string | null {
    return this.token;
  }
}

/** Scripted consent dialog: answers from a queue of 'send' | 'cancel'. */
export class ScriptedConsentDialog implements ConsentDialog {
  public readonly shown: ConsentRequest[] = [];
  constructor(private readonly answers: Array<'send' | 'cancel'>) {}
  async show(request: ConsentRequest): Promise<Consent | null> {
    this.shown.push(request);
    const answer = this.answers.shift() ?? 'cancel';
    return answer === 'send' ? Consent.grant(request.fileName, request.provider) : null;
  }
}

export class RecordingPanel implements SummaryPanel {
  public readonly shown: Array<{ fileName: string; summary: string }> = [];
  showReadOnly(fileName: string, summary: string): void {
    this.shown.push({ fileName, summary });
  }
}

/** Records errors; answers Retry prompts from a queue of booleans. */
export class ScriptedFeedback implements SummaryFeedback {
  public readonly errors: Array<{ message: string; retry: boolean }> = [];
  constructor(private readonly retryAnswers: boolean[] = []) {}
  async showError(message: string, options: { retry: boolean }): Promise<boolean> {
    this.errors.push({ message, retry: options.retry });
    return options.retry ? this.retryAnswers.shift() ?? false : false;
  }
  showProgress(): void {}
  clearProgress(): void {}
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
