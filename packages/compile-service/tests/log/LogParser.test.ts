import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAX_LOG_ENTRIES, parseLatexLog, toProjectPath } from '../../src/log/LogParser';

const LOGS = path.join(__dirname, '../../fixtures/logs');
const load = (name: string) => parseLatexLog(fs.readFileSync(path.join(LOGS, name)));
const errors = (name: string) => load(name).filter((e) => e.level === 'ERROR');
const warnings = (name: string) => load(name).filter((e) => e.level === 'WARNING');

describe('LogParser on real pdfTeX logs (fixtures/logs)', () => {
  it('1. undefined command in main.tex (TeX Live 2026 sandbox log from Step 4)', () => {
    expect(errors('undefined-command.log')).toEqual([
      { level: 'ERROR', file: 'main.tex', line: 5, message: 'Undefined control sequence.' },
    ]);
  });

  it('2. error inside an \\include-d subfile keeps the subfolder path', () => {
    expect(errors('subfile-error.log')).toEqual([
      { level: 'ERROR', file: 'chapters/intro.tex', line: 3, message: 'Undefined control sequence.' },
    ]);
  });

  it('3. missing package: file-less LaTeX Error + located emergency stop + fatal info', () => {
    const all = load('missing-package.log');
    expect(all).toContainEqual({ level: 'ERROR', message: "LaTeX Error: File `doesnotexist.sty' not found." });
    expect(all).toContainEqual(expect.objectContaining({ level: 'ERROR', file: 'main.tex', line: 3 }));
    expect(all).toContainEqual({ level: 'INFO', message: 'Fatal error occurred, no output PDF file produced.' });
  });

  it('4. undefined references and citations: warnings attributed to the right file and line', () => {
    expect(warnings('undefined-refs.log')).toEqual([
      { level: 'WARNING', file: 'main.tex', line: 3, message: "Reference `fig:missing' on page 1 undefined" },
      { level: 'WARNING', file: 'chapters/intro.tex', line: 3, message: "Reference `sec:nowhere' on page 2 undefined" },
      { level: 'WARNING', file: 'main.tex', line: 5, message: "Citation `nobody2020' on page 3 undefined" },
      { level: 'WARNING', message: 'There were undefined references.' }, // D2: no file → not clickable
    ]);
    expect(errors('undefined-refs.log')).toEqual([]);
  });

  it('5. multi-line package warning and overfull box', () => {
    expect(warnings('warnings.log')).toEqual([
      { level: 'WARNING', file: 'main.tex', line: 4, message: 'demo: Something odd happened on a second line' },
      { level: 'WARNING', file: 'main.tex', line: 5, message: 'Overfull \\hbox (194.81703pt too wide)' },
    ]);
  });

  it('6. missing \\end{document}: emergency stop with the abort reason, no file', () => {
    expect(errors('no-end.log')).toEqual([
      { level: 'ERROR', message: 'Emergency stop: job aborted, no legal \\end found.' },
    ]);
  });

  it('reports pages written as INFO on success', () => {
    expect(load('subfile-error.log')).toContainEqual({ level: 'INFO', message: 'Output written (2 pages, 22669 bytes).' });
  });

  it('never reports TeX system files (/usr/...) or /build files as clickable', () => {
    for (const f of fs.readdirSync(LOGS)) {
      for (const e of load(f)) {
        if (e.file) {
          expect(e.file.startsWith('/')).toBe(false);
          expect(e.file.startsWith('./')).toBe(false);
        }
      }
    }
  });
});

describe('LogParser edge cases', () => {
  it('strips /work/ and ./ prefixes', () => {
    expect(parseLatexLog('/work/chapters/a.tex:12: Missing $ inserted.\nl.12 x\n')).toEqual([
      { level: 'ERROR', file: 'chapters/a.tex', line: 12, message: 'Missing $ inserted.' },
    ]);
    expect(toProjectPath('./././main.tex')).toBe('main.tex');
    expect(toProjectPath('/usr/local/texlive/x.sty')).toBeUndefined();
    expect(toProjectPath('/build/main.aux')).toBeUndefined();
  });

  it('keeps a non-project file:line error but makes it non-clickable', () => {
    expect(parseLatexLog('/build/main.aux:3: Undefined control sequence.\n')).toEqual([
      { level: 'ERROR', message: '/build/main.aux:3: Undefined control sequence.' },
    ]);
  });

  it('decodes invalid UTF-8 with replacement characters instead of throwing (D3)', () => {
    const buf = Buffer.concat([Buffer.from('./main.tex:2: Bad '), Buffer.from([0xe9, 0xff]), Buffer.from(' char.\n')]);
    const [e] = parseLatexLog(buf);
    expect(e).toMatchObject({ level: 'ERROR', file: 'main.tex', line: 2 });
    expect(e.message).toContain('�');
  });

  it('handles Windows line endings and empty input', () => {
    expect(parseLatexLog('./main.tex:1: Oops.\r\nl.1 x\r\n')).toHaveLength(1);
    expect(parseLatexLog('')).toEqual([]);
  });

  it('de-duplicates identical entries', () => {
    expect(parseLatexLog('./main.tex:1: Oops.\n./main.tex:1: Oops.\n')).toHaveLength(1);
  });

  it(`caps at ${MAX_LOG_ENTRIES} entries, keeps errors first and says how many were dropped (D3)`, () => {
    const warns = Array.from({ length: 600 }, (_, i) => `LaTeX Warning: W${i} on input line ${i + 1}.\n`).join('\n');
    const errs = Array.from({ length: 10 }, (_, i) => `./main.tex:${i + 1}: E${i}.\nl.${i + 1} x\n`).join('');
    const out = parseLatexLog(`(./main.tex\n${warns}\n${errs})`);
    expect(out).toHaveLength(MAX_LOG_ENTRIES);
    expect(out.filter((e) => e.level === 'ERROR')).toHaveLength(10);
    expect(out.at(-1)).toEqual({ level: 'INFO', message: 'Log truncated: 111 more entries not shown.' });
  });

  it('is not confused by unbalanced parentheses in echoed source lines', () => {
    const log = [
      '(./main.tex',
      './main.tex:4: Undefined control sequence.',
      'l.4 \\foo (an unclosed paren',
      '                              ',
      '',
      'LaTeX Warning: Reference `x\' on page 1 undefined on input line 9.',
      ')',
    ].join('\n');
    expect(parseLatexLog(log)[1]).toEqual({ level: 'WARNING', file: 'main.tex', line: 9, message: "Reference `x' on page 1 undefined" });
  });
});
