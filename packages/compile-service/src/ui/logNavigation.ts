import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogEntry } from '../types';

/**
 * Step 9 logic for CompileLogView (the view itself is Member 2's UI). On click:
 *   const target = resolveLogClick(entry, project.rootDir);
 *   if (target.kind === 'open') { EditorView.open(target.absPath); EditorView.setCursor(target.line); }
 *   else if (target.kind === 'file-not-found') showMessage(`File not found: ${target.file}`);
 */
export type LogClickTarget =
  | { kind: 'open'; absPath: string; file: string; line: number }
  | { kind: 'file-not-found'; file: string }
  | { kind: 'not-clickable' };

export function isClickable(entry: LogEntry): boolean {
  return !!entry.file; // D2
}

export function resolveLogClick(entry: LogEntry, projectRoot: string, exists: (p: string) => boolean = fs.existsSync): LogClickTarget {
  if (!entry.file) return { kind: 'not-clickable' };
  const root = path.resolve(projectRoot);
  const absPath = path.resolve(root, entry.file);
  // Never open anything outside the project, whatever the log says.
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'not-clickable' };
  if (!exists(absPath)) return { kind: 'file-not-found', file: entry.file };
  return { kind: 'open', absPath, file: entry.file, line: entry.line && entry.line > 0 ? entry.line : 1 };
}

// Display helpers live in logFormat.ts (no Node imports, so the renderer can use them too).
export { formatLogEntry, summarizeLog } from './logFormat';
