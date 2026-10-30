/**
 * WS-3 renderer: Compile / Cancel, PDF preview (pdf.js), Outdated banner, clickable compile log.
 * Bundled with esbuild into dist/renderer/ws3.js (pdf.js is an ES module, the shell's tsc build is not).
 *
 * Shell contract (Member 2, client/src/renderer/renderer.ts):
 *   - window.EditorView = { open(relativePath), setCursor(line), saveAll() } wraps the CodeMirror editor;
 *   - the shell fires `app:projectOpened` {id} / `app:projectClosed` on window when a project opens/closes;
 *   - the shell listens for `ws3:devLogin` (LTX_DEV=1 only) to skip the login overlay.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { CompileResultForRenderer, LogEntry } from '@latexllm/compile-service';
import { previewState, type PreviewState } from '@latexllm/compile-service/src/ui/previewState';
import { formatLogEntry, summarizeLog } from '@latexllm/compile-service/src/ui/logFormat';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

type EditorHook = NonNullable<Window['EditorView']>;

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e: HTMLElementTagNameMap[K] = document.createElement(tag);
    Object.assign(e, props);
    e.append(...kids);
    return e;
}

/* ------------------------------------------------------------------ PDF preview */

class PdfPreview {
    private readonly pages = el('div', { className: 'ws3-pages' });
    private renderSeq = 0;
    /** pdf.js 6: a document is released through its loading task. */
    private task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    private lastBytes: Uint8Array | null = null;
    private resizeTimer: number | undefined;

    constructor(private readonly host: HTMLElement) {
        host.append(this.pages);
        new ResizeObserver(() => {
            window.clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => { if (this.lastBytes) void this.render(this.lastBytes); }, 150);
        }).observe(host);
    }

    clear(): void {
        this.renderSeq++;
        this.lastBytes = null;
        void this.task?.destroy();
        this.task = null;
        this.pages.replaceChildren();
    }

    async render(bytes: Uint8Array): Promise<void> {
        const seq = ++this.renderSeq;
        this.lastBytes = bytes;
        const scrollTop = this.host.scrollTop;
        // pdf.js transfers (detaches) the buffer it is given, so pass a copy and keep ours for re-renders.
        const task = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await task.promise;
        if (seq !== this.renderSeq) { void task.destroy(); return; }
        const width = Math.max(200, this.pages.clientWidth || this.host.clientWidth - 32);
        const dpr = window.devicePixelRatio || 1;
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const base = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: (width / base.width) * dpr });
            const canvas = el('canvas', { className: 'page', width: Math.floor(vp.width), height: Math.floor(vp.height) });
            canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
            await page.render({ canvas, viewport: vp }).promise;
            if (seq !== this.renderSeq) { void task.destroy(); return; }
            canvases.push(canvas);
        }
        void this.task?.destroy();
        this.task = task;
        this.pages.replaceChildren(...canvases);
        this.host.scrollTop = scrollTop;
    }
}

/* ------------------------------------------------------------------ panel */

type Tone = 'ok' | 'error' | 'busy' | 'idle';

class CompilePanel {
    private projectId: string | null = null;
    private compileSeq = 0;
    private running = 0;
    private tick: number | undefined;

    private get editor(): EditorHook | undefined { return window.EditorView; }
    private readonly preview: PdfPreview;

    private readonly modeChip = el('span', { className: 'ws3-chip' });

    // preview pane
    private readonly compileBtn = el('button', { type: 'button', className: 'primary', textContent: 'Compile', disabled: true, title: 'Save all files and compile (Ctrl+Enter)' });
    private readonly cancelBtn = el('button', { type: 'button', textContent: 'Cancel', disabled: true });
    private readonly dot = el('span', { className: 'status-dot' });
    private readonly statusText = el('span', { className: 'ws3-status', textContent: 'No project open' });
    private readonly banner = el('div', { className: 'ws3-banner', hidden: true });
    private readonly logBox = el('details', { className: 'ws3-log', hidden: true });
    private readonly logSummary = el('summary');
    private readonly logList = el('ul');
    private readonly toast = el('div', { className: 'ws3-toast', hidden: true, role: 'status' });

    constructor() {
        const pane = $<HTMLDivElement>('#pdf-preview')!;
        const toolbar = el('div', { className: 'ws3-toolbar' }, this.compileBtn, this.cancelBtn, el('span', { className: 'ws3-state' }, this.dot, this.statusText), this.modeChip);
        this.logBox.append(this.logSummary, this.logList);
        pane.append(toolbar, this.banner, this.logBox);
        this.preview = new PdfPreview(pane);
        document.body.append(this.toast);

        this.compileBtn.addEventListener('click', () => void this.compile());
        this.cancelBtn.addEventListener('click', () => void this.cancel());
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !this.compileBtn.disabled) { e.preventDefault(); void this.compile(); }
        });
        // The shell owns login, the project list and the editor; the panel follows the open project.
        window.addEventListener('app:projectOpened', (e) => void this.openProject((e as CustomEvent<{ id: string }>).detail.id));
        window.addEventListener('app:projectClosed', () => void this.openProject(null));

        void this.init();
    }

    private async init() {
        const info = await window.ws3.info();
        this.modeChip.textContent = info.stub ? 'Stub compiler' : 'Docker sandbox';
        this.modeChip.title = info.stub ? 'LTX_STUB_COMPILE=1: sample PDF, no Docker' : 'Compiles in the ltx-sandbox:1 container';
        if (info.dev) this.addDevLoginSkip();
    }

    /** LTX_DEV=1 only: lets WS-3 be tested while the auth backend is not reachable from the shell. */
    private addDevLoginSkip() {
        const card = $<HTMLDivElement>('.auth-card');
        if (!card) return;
        const btn = el('button', { type: 'button', className: 'auth-toggle', textContent: 'Skip login (dev mode)' });
        // The shell enters the app as user "dev" and shows its own project overlay.
        btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ws3:devLogin')));
        card.append(btn);
    }

    private async openProject(id: string | null) {
        if (this.running && this.projectId) void window.ws3.cancel(this.projectId);
        this.compileSeq++;
        this.running = 0;
        this.stopTick();
        this.projectId = id;
        this.preview.clear();
        this.renderLog([]);
        this.compileBtn.disabled = !id;
        this.cancelBtn.disabled = true;
        if (!id) {
            this.setStatus('idle', 'No project open');
            this.showBanner(undefined);
            return;
        }
        window.ws3.projectOpened(id);
        // Step 10: reload the last good PDF and log when a project opens.
        const [pdf, log] = await Promise.all([window.ws3.getPdf(id), window.ws3.getLatestLog(id)]);
        if (this.projectId !== id) return;
        this.renderLog(log);
        this.setStatus('idle', pdf ? 'Showing the last successful build' : 'Not compiled yet');
        await this.applyPreview(previewState(null, pdf !== null), pdf);
    }

    private async compile() {
        const id = this.projectId;
        if (!id) return;
        const seq = ++this.compileSeq;
        try {
            await this.editor?.saveAll(); // C1: compile what is on disk (flushes the shell's auto-save)
        } catch (e) {
            this.notify(`Save failed, compile not started: ${cleanIpcError(e)}`, 'error');
            return;
        }
        if (seq !== this.compileSeq || this.projectId !== id) return;
        this.running++;
        this.cancelBtn.disabled = false;
        this.startTick();
        let r: CompileResultForRenderer;
        try {
            r = await window.ws3.compile(id); // a second click cancels the first job in the main process (flow 5)
        } catch (e) {
            r = { status: 'SANDBOX_UNAVAILABLE', log: [{ level: 'ERROR', message: cleanIpcError(e) }], durationMs: 0, hasPdf: false };
        } finally {
            this.running = Math.max(0, this.running - 1);
        }
        if (seq !== this.compileSeq || this.projectId !== id) return; // superseded: the newer job reports
        this.stopTick();
        this.cancelBtn.disabled = true;

        this.renderLog(r.log);
        const secs = (r.durationMs / 1000).toFixed(1);
        const s = summarizeLog(r.log);
        const text: Record<CompileResultForRenderer['status'], [Tone, string]> = {
            SUCCESS: ['ok', `Compiled in ${secs} s · ${s.text}`],
            FAILED: ['error', `Failed after ${secs} s · ${s.text}`],
            TIMEOUT: ['error', `Stopped after ${secs} s (60 s limit)`],
            CANCELLED: ['idle', 'Cancelled'],
            SANDBOX_UNAVAILABLE: ['error', 'Sandbox unavailable: is Docker Desktop running?']
        };
        this.setStatus(...text[r.status]);
        const pdf = r.hasPdf ? await window.ws3.getPdf(id) : null;
        if (this.projectId !== id || seq !== this.compileSeq) return;
        await this.applyPreview(previewState(r.status, pdf !== null), pdf);
        if (r.status === 'FAILED') this.logBox.open = true;
    }

    private async cancel() {
        if (!this.projectId) return;
        this.cancelBtn.disabled = true;
        await window.ws3.cancel(this.projectId);
    }

    private async applyPreview(state: PreviewState, pdf: Uint8Array | null) {
        this.showBanner(state.banner, state.tone);
        if (state.showPdf && pdf) {
            try {
                await this.preview.render(pdf);
            } catch (e) {
                this.showBanner(`Could not display the PDF: ${(e as Error).message}`, 'error');
            }
        } else if (!state.showPdf) {
            this.preview.clear();
        }
    }

    private showBanner(text?: string, tone?: string) {
        this.banner.hidden = !text;
        this.banner.textContent = text ?? '';
        this.banner.dataset.tone = tone ?? 'info';
    }

    private setStatus(tone: Tone, text: string) {
        if (tone === 'idle') delete this.dot.dataset.state; else this.dot.dataset.state = tone;
        this.statusText.textContent = text;
    }

    private startTick() {
        const t0 = Date.now();
        this.stopTick();
        const upd = () => this.setStatus('busy', `Compiling… ${Math.floor((Date.now() - t0) / 1000)} s`);
        upd();
        this.tick = window.setInterval(upd, 1000);
    }

    private stopTick() {
        window.clearInterval(this.tick);
        this.tick = undefined;
    }

    private renderLog(log: LogEntry[]) {
        this.logBox.hidden = log.length === 0;
        if (log.length === 0) { this.logList.replaceChildren(); return; }
        const s = summarizeLog(log);
        this.logSummary.textContent = `Log · ${s.text}${s.info ? `, ${s.info} info` : ''}`;
        this.logList.replaceChildren(...log.map((entry) => {
            const li = el('li', { className: `ws3-entry ws3-${entry.level.toLowerCase()}` });
            const text = formatLogEntry(entry);
            if (entry.file) {
                const b = el('button', { type: 'button', className: 'ws3-link', textContent: text, title: 'Go to file and line' });
                b.addEventListener('click', () => void this.goTo(entry));
                li.append(el('span', { className: 'ws3-level', textContent: entry.level }), b);
            } else {
                li.append(el('span', { className: 'ws3-level', textContent: entry.level }), el('span', { textContent: text }));
            }
            return li;
        }));
    }

    /** Step 9: click on a log entry → open the file and put the cursor on the line. */
    private async goTo(entry: LogEntry) {
        const id = this.projectId;
        if (!id) return;
        const t = await window.ws3.resolveLogClick(id, entry);
        if (t.kind === 'open') {
            const editor = this.editor;
            if (!editor) { this.notify('The editor is not available', 'error'); return; }
            try {
                await editor.open(t.file);
                editor.setCursor(t.line);
            } catch (e) {
                this.notify(`Could not open ${t.file}: ${cleanIpcError(e)}`, 'error');
            }
        } else if (t.kind === 'file-not-found') {
            this.notify(`File not found: ${t.file}`, 'error');
        }
    }

    private notify(msg: string, tone = 'info') {
        this.toast.textContent = msg;
        this.toast.dataset.tone = tone;
        this.toast.hidden = false;
        window.clearTimeout((this.toast as any)._t);
        (this.toast as any)._t = window.setTimeout(() => { this.toast.hidden = true; }, 4000);
    }
}

/** Electron prefixes errors thrown in ipcMain handlers with "Error invoking remote method '…': Error: ". */
function cleanIpcError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

new CompilePanel();
