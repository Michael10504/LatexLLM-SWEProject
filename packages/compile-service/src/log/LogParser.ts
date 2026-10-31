import type { LogEntry } from '../types';

/** D3: never return more than this many entries. */
export const MAX_LOG_ENTRIES = 500;

/** Errors in -file-line-error style: ./chapters/intro.tex:3: Undefined control sequence. */
const FILE_LINE_ERROR = /^(.+?\.[A-Za-z0-9]+):(\d+): (.*)$/;
const WARNING_START = /^(LaTeX|LaTeX Font|Package (\S+)|Class (\S+)) Warning: (.*)$/;
const BOX = /^((?:Over|Under)full \\[hv]box \([^)]*\))(?: in paragraph at lines (\d+)--\d+| detected at line (\d+)| in alignment at lines (\d+)--\d+|.*)/;
const ON_INPUT_LINE = /\s*on input line (\d+)\.?$/;
const FATAL = /==> Fatal error occurred, no output PDF file produced!/;
const OUTPUT_WRITTEN = /^Output written on .*?\((\d+) pages?, (\d+) bytes\)\.$/;
/** A path TeX prints after "(" when it opens a file. */
const OPEN_FILE = /^(?:\.{1,2}\/|\/|[A-Za-z]:[\\/])?[^\s(){}[\]"]*\.[A-Za-z0-9]+/;

/** Turn a path from the log into a project-relative path, or undefined if it is not a project file. */
export function toProjectPath(raw: string): string | undefined {
  let p = raw.trim().replace(/\\/g, '/');
  if (p.startsWith('/work/')) p = p.slice('/work/'.length);
  while (p.startsWith('./')) p = p.slice(2);
  if (!p || p.startsWith('/') || p.startsWith('../') || /^[A-Za-z]:\//.test(p)) return undefined;
  return p;
}

function decode(input: string | Buffer | Uint8Array): string {
  // D3: UTF-8 with U+FFFD for invalid bytes (pdfTeX writes raw 8-bit bytes for non-ASCII input).
  const text = typeof input === 'string' ? input : Buffer.from(input).toString('utf8');
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Parse a pdfTeX/LaTeX main.log (written with -file-line-error and max_print_line=10000)
 * into LogEntry[]. Errors carry file + line when TeX reports them; warnings get a file only
 * when the innermost open file is a project file (D2: otherwise not clickable).
 */
export function parseLatexLog(input: string | Buffer | Uint8Array, max = MAX_LOG_ENTRIES): LogEntry[] {
  const lines = decode(input).split('\n');
  const out: LogEntry[] = [];
  const seen = new Set<string>();
  /** Open-file stack: a path for "(file", null for any other "(" so ")" stays balanced. */
  const stack: (string | null)[] = [];

  const add = (e: LogEntry) => {
    const key = `${e.level}|${e.file ?? ''}|${e.line ?? ''}|${e.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  const currentFile = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (f !== null) return toProjectPath(f);
    }
    return undefined;
  };
  const trackFiles = (line: string) => {
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '(') {
        const m = OPEN_FILE.exec(line.slice(i + 1));
        stack.push(m ? m[0] : null);
      } else if (c === ')' && stack.length > 0) {
        stack.pop();
      }
    }
  };

  let skip = 0; // lines to skip from file tracking (source-code echoes may have unbalanced parens)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- errors with file:line ---
    const fle = FILE_LINE_ERROR.exec(line);
    if (fle && !line.startsWith('(')) {
      const msg = fle[3].trim();
      if (FATAL.test(msg)) {
        add({ level: 'INFO', message: 'Fatal error occurred, no output PDF file produced.' });
      } else {
        const file = toProjectPath(fle[1]);
        add(file ? { level: 'ERROR', file, line: Number(fle[2]), message: withAbortReason(msg, lines, i) }
                 : { level: 'ERROR', message: `${fle[1]}:${fle[2]}: ${msg}` });
      }
      skip = contextLines(lines, i);
      continue;
    }

    // --- errors without a location ("! LaTeX Error: ...", "! Emergency stop.") ---
    if (line.startsWith('! ')) {
      const msg = line.slice(2).trim();
      if (FATAL.test(msg)) add({ level: 'INFO', message: 'Fatal error occurred, no output PDF file produced.' });
      else add({ level: 'ERROR', message: withAbortReason(msg, lines, i) });
      skip = contextLines(lines, i);
      continue;
    }

    // --- LaTeX / package / class / font warnings (may continue on following lines) ---
    const w = WARNING_START.exec(line);
    if (w) {
      const source = w[2] ?? w[3]; // package or class name
      let text = w[4].trim();
      let j = i + 1;
      const cont = source ? new RegExp(`^\\(${escapeRe(source)}\\)\\s+(.*)$`) : /^\(Font\)\s+(.*)$/;
      while (j < lines.length && lines[j].trim() !== '') {
        const m = cont.exec(lines[j]);
        if (m) text += ' ' + m[1].trim();
        else if (!source && w[1] === 'LaTeX' && /^\s+\S/.test(lines[j])) text += ' ' + lines[j].trim(); // \MessageBreak lines are indented
        else break;
        j++;
      }
      const lm = ON_INPUT_LINE.exec(text);
      const lineNo = lm ? Number(lm[1]) : undefined;
      if (lm) text = text.slice(0, lm.index).trim();
      text = text.replace(/\s+/g, ' ');
      const message = source ? `${source}: ${text}` : text;
      const file = lineNo !== undefined ? currentFile() : undefined;
      add(file ? { level: 'WARNING', file, line: lineNo, message } : { level: 'WARNING', message });
      i = j - 1;
      continue;
    }

    // --- overfull / underfull boxes ---
    const b = BOX.exec(line);
    if (b) {
      const lineNo = Number(b[2] ?? b[3] ?? b[4]) || undefined;
      const file = lineNo !== undefined ? currentFile() : undefined;
      add(file ? { level: 'WARNING', file, line: lineNo, message: b[1] } : { level: 'WARNING', message: b[1] });
      // Skip the box contents (it echoes document text) up to the " []" or blank line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && lines[j].trim() !== '[]') j++;
      i = j;
      continue;
    }

    if (line.trim() === 'No pages of output.') {
      add({ level: 'WARNING', message: 'No pages of output.' });
      continue;
    }
    const ow = OUTPUT_WRITTEN.exec(line);
    if (ow) {
      add({ level: 'INFO', message: `Output written (${ow[1]} page${ow[1] === '1' ? '' : 's'}, ${ow[2]} bytes).` });
      continue;
    }

    if (skip > 0) {
      skip--;
      continue;
    }
    trackFiles(line);
  }

  return cap(out, max);
}

/** "! Emergency stop." is followed by "*** (job aborted, ...)" — fold the reason into the message. */
function withAbortReason(msg: string, lines: string[], i: number): string {
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    const m = /^\*\*\* \((.*)\)$/.exec(lines[j].trim());
    if (m) return `${msg.replace(/\.$/, '')}: ${m[1]}.`;
  }
  return msg;
}

/** After an error TeX echoes "l.N <source>" and the rest of the line; don't track parens in those. */
function contextLines(lines: string[], i: number): number {
  for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
    if (/^l\.\d+ /.test(lines[j]) || /^<[^>]*> /.test(lines[j])) return j - i + 1;
  }
  return 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** D3 cap. When over the limit keep errors first, then warnings, then info; keep log order; say what was dropped. */
function cap(entries: LogEntry[], max: number): LogEntry[] {
  if (entries.length <= max) return entries;
  const rank = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  const keep = entries
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => rank[a.e.level] - rank[b.e.level] || a.idx - b.idx)
    .slice(0, max - 1)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.e);
  keep.push({ level: 'INFO', message: `Log truncated: ${entries.length - (max - 1)} more entries not shown.` });
  return keep;
}
