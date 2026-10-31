/**
 * CD-1 «entity» Consent — valid for ONE request only (FR-05.2).
 *
 * Only ConsentDialog can mint one (via the user clicking Send). The adapter
 * calls consume() right before transmitting; a second consume() throws, so a
 * retry can never silently reuse the previous click.
 */
export class Consent {
  private used = false;

  private constructor(
    public readonly givenAt: Date,
    public readonly fileName: string,
    public readonly provider: string
  ) {}

  /** Called only by a ConsentDialog when the user clicks Send. */
  public static grant(fileName: string, provider: string, now: Date = new Date()): Consent {
    return new Consent(now, fileName, provider);
  }

  public isUsed(): boolean {
    return this.used;
  }

  public consume(): void {
    if (this.used) {
      throw new Error('Consent has already been used; ask the user again for this request.');
    }
    this.used = true;
  }
}

/** The fixed statement shown in the dialog (FR-05.2). */
export const THIRD_PARTY_STATEMENT =
  'The whole file will be sent to a third-party cloud service for summarization. ' +
  'This consent applies to this one request only.';
