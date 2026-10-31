import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CompileResult, CompileService, LogEntry, Project } from './types';

// Smallest valid one-page PDF ("Stub PDF"), so the preview can render without Docker.
const SAMPLE_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 760 Td (Stub PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

/** No-Docker stand-in: returns a sample PDF and log after ~1 s. */
export class StubCompileService implements CompileService {
  private logs = new Map<string, LogEntry[]>();
  private timers = new Map<string, { timer: NodeJS.Timeout; resolve: (r: CompileResult) => void }>();

  constructor(private readonly delayMs = 1000) {}

  compile(project: Project): Promise<CompileResult> {
    const started = Date.now();
    this.supersede(project.id, started);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(project.id);
        const pdfPath = path.join(os.tmpdir(), `ltx-stub-${project.id.replace(/[^\w.-]/g, '_')}.pdf`);
        fs.writeFileSync(pdfPath, SAMPLE_PDF);
        this.logs.set(project.id, []);
        resolve({ status: 'SUCCESS', pdfPath, log: [], durationMs: Date.now() - started });
      }, this.delayMs);
      this.timers.set(project.id, { timer, resolve });
    });
  }

  async cancel(projectId: string): Promise<void> {
    this.supersede(projectId, Date.now());
  }

  getLatestLog(project: Project): LogEntry[] {
    return this.logs.get(project.id) ?? [];
  }

  private supersede(projectId: string, started: number): void {
    const running = this.timers.get(projectId);
    if (!running) return;
    clearTimeout(running.timer);
    this.timers.delete(projectId);
    running.resolve({ status: 'CANCELLED', log: [], durationMs: Date.now() - started });
  }
}
