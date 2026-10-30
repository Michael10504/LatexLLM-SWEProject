import type { CompileStatus } from '../types';

/**
 * Step 10 logic for PdfPreview (the pdf.js view itself is Member 2's UI). After each compile,
 * or when a project opens, compute what the preview should show:
 *   const state = previewState(result?.status ?? null, result?.hasPdf ?? hasLastGood);
 *   if (state.showPdf) render(await window.ws3.getPdf(id));   // keep showing the last good PDF
 *   banner(state.banner);                                       // e.g. "Outdated: …"
 */
export interface PreviewState {
  /** Render the last good PDF (true even after a failed build: demo flow 3). */
  showPdf: boolean;
  /** The PDF on screen is not from the latest compile. */
  outdated: boolean;
  /** Text for the banner above the PDF, or undefined for none. */
  banner?: string;
  /** Banner tone for styling. */
  tone?: 'warning' | 'error' | 'info';
}

const OUTDATED: Record<Exclude<CompileStatus, 'SUCCESS'>, { text: string; tone: PreviewState['tone'] }> = {
  FAILED: { text: 'Outdated: the last compile failed. See the log for errors.', tone: 'error' },
  TIMEOUT: { text: 'Outdated: the last compile was stopped after 60 seconds.', tone: 'warning' },
  CANCELLED: { text: 'Outdated: the last compile was cancelled.', tone: 'info' },
  SANDBOX_UNAVAILABLE: { text: 'Outdated: the LaTeX sandbox is not available. Start Docker Desktop and compile again.', tone: 'error' },
};

/**
 * @param status  status of the latest compile, or null when nothing has been compiled this session
 * @param hasPdf  whether a last good PDF exists (CompileResultForRenderer.hasPdf, or getPdf() !== null)
 */
export function previewState(status: CompileStatus | null, hasPdf: boolean): PreviewState {
  if (status === null) {
    // Project just opened (Step 10: reload lastGood.pdf).
    return hasPdf ? { showPdf: true, outdated: false } : { showPdf: false, outdated: false, banner: 'No PDF yet. Press Compile.', tone: 'info' };
  }
  if (status === 'SUCCESS') return { showPdf: hasPdf, outdated: false };
  const o = OUTDATED[status];
  if (!hasPdf) {
    // Nothing to keep on screen: say what happened without "Outdated".
    return { showPdf: false, outdated: false, banner: o.text.replace(/^Outdated: (.)/, (_m, c: string) => c.toUpperCase()), tone: o.tone };
  }
  return { showPdf: true, outdated: true, banner: o.text, tone: o.tone };
}
