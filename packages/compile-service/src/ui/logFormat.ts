import type { LogEntry } from '../types';

/* Renderer-safe: no Node imports. */

/** One line per entry, as the log view shows it: "chapters/intro.tex:3: Undefined control sequence." */
export function formatLogEntry(entry: LogEntry): string {
  const where = entry.file ? `${entry.file}${entry.line ? `:${entry.line}` : ''}: ` : '';
  return `${where}${entry.message}`;
}

/** Counts for the log view's header ("2 errors, 3 warnings"). */
export function summarizeLog(log: LogEntry[]): { errors: number; warnings: number; info: number; text: string } {
  const errors = log.filter((e) => e.level === 'ERROR').length;
  const warnings = log.filter((e) => e.level === 'WARNING').length;
  const info = log.length - errors - warnings;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return { errors, warnings, info, text: `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` };
}
