import { PDFDocument } from 'pdf-lib';
/** Production counter, including compressed object streams; rejects encrypted/unreadable files. */
export async function exactPageCounter(bytes: Uint8Array): Promise<number> {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}
