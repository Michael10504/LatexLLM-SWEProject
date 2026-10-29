/** A PDF the user picked, already read into memory. */
export interface PdfFile {
  name: string;
  bytes: Uint8Array;
}

export type PdfValidationResult =
  | { valid: true; sizeBytes: number; pageCount: number }
  | { valid: false; reason: string };

/**
 * Counts pages. The default counter is dependency-free; in the Electron client
 * you can swap in PDF.js (Design Spec 4.1 IF-07) by passing
 *   async (bytes) => (await pdfjs.getDocument({ data: bytes }).promise).numPages
 */
export type PageCounter = (bytes: Uint8Array) => Promise<number>;

/**
 * Heuristic page counter: reads the /Count of the root /Pages node, falling
 * back to counting /Type /Page objects. Good enough for validation of normal
 * academic PDFs; use PDF.js for exact counts on compressed object streams.
 */
export const defaultPageCounter: PageCounter = async (bytes) => {
  const text = Buffer.from(bytes).toString('latin1');

  let maxCount = 0;
  const pagesNode = /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g;
  for (const match of text.matchAll(pagesNode)) {
    const n = Number(match[1] ?? match[2]);
    if (n > maxCount) maxCount = n;
  }
  if (maxCount > 0) return maxCount;

  return (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
};

/**
 * CD-3c PdfValidator (FR-05.1): valid PDF, at most 20 MB and 100 pages.
 * Nothing is transmitted unless this passes.
 */
export class PdfValidator {
  public static readonly MAX_MB = 20;
  public static readonly MAX_BYTES = PdfValidator.MAX_MB * 1024 * 1024;
  public static readonly MAX_PAGES = 100;

  constructor(private readonly countPages: PageCounter = defaultPageCounter) {}

  public async validate(file: PdfFile): Promise<PdfValidationResult> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return { valid: false, reason: 'The selected file is not a PDF.' };
    }

    const size = file.bytes.byteLength;
    if (size === 0) {
      return { valid: false, reason: 'The selected PDF is empty.' };
    }
    if (size > PdfValidator.MAX_BYTES) {
      return {
        valid: false,
        reason: `The PDF is ${formatBytes(size)}; the maximum is ${PdfValidator.MAX_MB} MB.`
      };
    }

    const header = Buffer.from(file.bytes.subarray(0, 5)).toString('ascii');
    if (header !== '%PDF-') {
      return { valid: false, reason: 'The file is not a valid PDF document.' };
    }

    let pages: number;
    try {
      pages = await this.countPages(file.bytes);
    } catch {
      return { valid: false, reason: 'The PDF could not be read.' };
    }
    if (pages < 1) {
      return { valid: false, reason: 'The PDF has no readable pages.' };
    }
    if (pages > PdfValidator.MAX_PAGES) {
      return {
        valid: false,
        reason: `The PDF has ${pages} pages; the maximum is ${PdfValidator.MAX_PAGES}.`
      };
    }

    return { valid: true, sizeBytes: size, pageCount: pages };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
