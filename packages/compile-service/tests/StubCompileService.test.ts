import * as fs from 'node:fs';
import { StubCompileService } from '../src/StubCompileService';

describe('StubCompileService', () => {
  const project = { id: 'demo', rootDir: '/tmp/demo' };

  it('returns a sample PDF and log', async () => {
    const s = new StubCompileService(10);
    const r = await s.compile(project);
    expect(r.status).toBe('SUCCESS');
    expect(fs.readFileSync(r.pdfPath!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(s.getLatestLog(project)).toHaveLength(3);
  });

  it('a second compile cancels the first', async () => {
    const s = new StubCompileService(50);
    const first = s.compile(project);
    const second = s.compile(project);
    await expect(first).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(second).resolves.toMatchObject({ status: 'SUCCESS' });
  });
});
