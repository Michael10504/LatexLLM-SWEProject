import * as path from 'node:path';
import { formatLogEntry, isClickable, resolveLogClick, summarizeLog } from '../../src/ui/logNavigation';
import { previewState } from '../../src/ui/previewState';

const root = path.resolve('/proj');
const exists = (p: string) => p === path.join(root, 'main.tex') || p === path.join(root, 'chapters', 'intro.tex');

describe('Step 9 log navigation', () => {
  it('opens the file at the line', () => {
    expect(resolveLogClick({ level: 'ERROR', file: 'chapters/intro.tex', line: 3, message: 'x' }, root, exists)).toEqual({
      kind: 'open', absPath: path.join(root, 'chapters', 'intro.tex'), file: 'chapters/intro.tex', line: 3,
    });
  });
  it('defaults to line 1 when the entry has a file but no line', () => {
    expect(resolveLogClick({ level: 'WARNING', file: 'main.tex', message: 'x' }, root, exists)).toMatchObject({ kind: 'open', line: 1 });
  });
  it('reports a file that no longer exists', () => {
    expect(resolveLogClick({ level: 'ERROR', file: 'gone.tex', line: 2, message: 'x' }, root, exists)).toEqual({ kind: 'file-not-found', file: 'gone.tex' });
  });
  it('entries without a file are not clickable (D2)', () => {
    const e = { level: 'WARNING' as const, message: 'There were undefined references.' };
    expect(isClickable(e)).toBe(false);
    expect(resolveLogClick(e, root, exists)).toEqual({ kind: 'not-clickable' });
  });
  it('never opens a path outside the project', () => {
    expect(resolveLogClick({ level: 'ERROR', file: '../secrets.txt', line: 1, message: 'x' }, root, () => true)).toEqual({ kind: 'not-clickable' });
  });
  it('formats and summarises entries', () => {
    expect(formatLogEntry({ level: 'ERROR', file: 'main.tex', line: 5, message: 'Undefined control sequence.' })).toBe('main.tex:5: Undefined control sequence.');
    expect(formatLogEntry({ level: 'WARNING', message: 'There were undefined references.' })).toBe('There were undefined references.');
    expect(summarizeLog([{ level: 'ERROR', message: 'a' }, { level: 'WARNING', message: 'b' }, { level: 'WARNING', message: 'c' }, { level: 'INFO', message: 'd' }]).text).toBe('1 error, 2 warnings');
  });
});

describe('Step 10 preview state', () => {
  it('project opened with a last good PDF: show it, no banner', () => {
    expect(previewState(null, true)).toEqual({ showPdf: true, outdated: false });
  });
  it('project opened with nothing built yet', () => {
    expect(previewState(null, false)).toMatchObject({ showPdf: false, banner: 'No PDF yet. Press Compile.' });
  });
  it('success: show the new PDF, no banner', () => {
    expect(previewState('SUCCESS', true)).toEqual({ showPdf: true, outdated: false });
  });
  it('failed after a good build: keep the old PDF with an Outdated banner (demo flow 3)', () => {
    expect(previewState('FAILED', true)).toMatchObject({ showPdf: true, outdated: true, tone: 'error', banner: expect.stringMatching(/^Outdated: the last compile failed/) });
  });
  it('timeout shows a message (demo flow 4)', () => {
    expect(previewState('TIMEOUT', true).banner).toMatch(/stopped after 60 seconds/);
    expect(previewState('TIMEOUT', false)).toMatchObject({ showPdf: false, banner: 'The last compile was stopped after 60 seconds.' });
  });
  it('sandbox unavailable tells the user to start Docker', () => {
    expect(previewState('SANDBOX_UNAVAILABLE', false).banner).toMatch(/Start Docker Desktop/);
  });
});
