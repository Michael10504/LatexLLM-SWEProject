"""Run local JSON/JSONL requests or supplied held-out datasets, saving a local report."""
import argparse
import json
from pathlib import Path
import time
import re
from collections import Counter
from datetime import datetime
from local_ai import ROOT, Runner, offline, validate, model_for

def evaluate_case(row, result):
    """Explicit checks only; semantic quality still needs manual review."""
    checks = {}
    rules = row.get('checks', {})
    for literal in rules.get('preserve', []):
        checks[f'preserve {literal!r}'] = literal in result
    for pattern in rules.get('forbid_regex', []):
        checks[f'forbid /{pattern}/'] = re.search(pattern, result) is None
    if rules.get('must_change'):
        checks['input was rewritten'] = result.strip() != row.get('text', '').strip()
    for concept in rules.get('concepts', []):
        checks['covers ' + concept['name']] = any(re.search(pattern, result, re.I) for pattern in concept['patterns'])
    if rules.get('notes'):
        groups = json.loads(result)['groups']
        bullets = [note for group in groups for note in group['notes']]
        checks['distinct note themes'] = len({g['heading'].strip().casefold() for g in groups}) == len(groups)
        checks['concise note count'] = 1 <= len(bullets) <= rules.get('max_notes', 8)
        checks['notes are not the entire source'] = all(n.strip() != row.get('text', '').strip() for n in bullets)
    if rules.get('outline'):
        obj = json.loads(result)
        sections = obj.get('sections', [])
        headings = [s['heading'].strip().casefold() for s in sections]
        checks['distinct nonempty headings'] = bool(headings) and all(headings) and len(set(headings)) == len(headings)
        checks['nonempty subsections'] = all(s['subsections'] and all(x.strip() for x in s['subsections']) for s in sections)
        if 'max_sections' in rules:
            checks['outline length bound'] = len(sections) <= rules['max_sections']
        if rules.get('writing_directions'):
            checks['actionable writing directions'] = all(re.match(
                r'(?i)^(describe|discuss|explain|compare|evaluate|outline|present|summarize|state|identify|report|address|introduce|detail|assess|clarify|highlight|define|examine|review|acknowledge|note|specify|distinguish|interpret|contrast|justify|relate|link)\b', point.strip())
                for section in sections for point in section['subsections'])
    return checks

def text_report(report, elapsed, validate_only=False):
    """Readable benchmark report; timing is wall clock, not GPU instrumentation."""
    lines = ['LOCAL AI BENCHMARK AND RESULTS',
             f'Created: {datetime.now().astimezone().isoformat(timespec="seconds")}',
             f'Mode: {"input validation only (no inference)" if validate_only else "local model inference"}',
             f'Total wall time: {elapsed:.3f} seconds',
             f'Cases: {len(report)}',
             'Statuses: ' + ', '.join(f'{k}={v}' for k, v in sorted(Counter(r['status'] for r in report).items())),
             '', 'BENCHMARK SUMMARY BY TASK']
    for task in sorted({r.get('task', 'unknown') for r in report}):
        cases = [r for r in report if r.get('task', 'unknown') == task]
        successful = [r for r in cases if r['status'] in ('ok', 'quality_failed')]
        times = [r['inference_seconds'] for r in successful if 'inference_seconds' in r]
        lines.append(f'{task}: {len(cases)} cases, {len(successful)} completed inference runs')
        if times:
            lines.append(f'  Inference seconds: mean={sum(times)/len(times):.3f}, min={min(times):.3f}, max={max(times):.3f}')
        for key in ('exact_match', 'unchanged_input'):
            values = [r[key] for r in successful if key in r]
            if values:
                lines.append(f'  {key}: {sum(values)}/{len(values)} ({100*sum(values)/len(values):.1f}%)')
    lines += ['', 'Timing notes: model preparation includes loading/switching and archive extraction when needed.',
              'Inference timing excludes model preparation. First output measures the first emitted chunk;',
              'all four tasks stream generated text. Output words/sec is not tokens/sec.',
              'No GPU memory measurement or semantic quality guarantee is provided.',
              'quality_failed means an explicit acceptance check failed; inspect its output.',
              'Passing checks does not establish semantic fidelity or writing quality.', '', 'DETAILED RESULTS']
    for i, entry in enumerate(report, 1):
        lines += ['', '=' * 72, f'Case {i} | {entry.get("task", "unknown")} | {entry["status"]}',
                  f'Source: {entry["file"]} | Record: {entry.get("record", "n/a")}',
                  f'Case ID: {entry.get("case_id") or "unspecified"}']
        for key in ('model', 'gpu_layers', 'model_reused', 'seconds', 'model_prepare_seconds', 'inference_seconds',
                    'first_output_seconds', 'input_words', 'output_words', 'output_words_per_second',
                    'exact_match', 'unchanged_input', 'error'):
            if key in entry:
                lines.append(f'{key}: {entry[key]}')
        for key in ('input', 'output', 'expected'):
            if key in entry:
                lines += ['', key.upper() + ':', str(entry[key])]
        if entry.get('checks'):
            lines += ['', 'AUTOMATIC CHECKS:']
            lines.extend(f'  {"PASS" if ok else "FAIL"}: {name}' for name, ok in entry['checks'].items())
        if entry.get('review'):
            lines += ['', 'MANUAL REVIEW CRITERIA:'] + [f'  - {item}' for item in entry['review']]
        if entry.get('reference'):
            lines += ['', 'ILLUSTRATIVE REFERENCE (not an exact-match target):', entry['reference']]
    return '\n'.join(lines) + '\n'

def records(path):
    if path.suffix == '.jsonl':
        with path.open(encoding='utf-8-sig') as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)
    else:
        obj = json.loads(path.read_text(encoding='utf-8-sig'))
        if isinstance(obj, list):
            yield from obj
        elif isinstance(obj, dict) and 'requests' in obj:
            yield from obj['requests']
        else:
            yield obj

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('paths', nargs='*', type=Path, help='JSON/JSONL files or folders')
    p.add_argument('--limit', type=int, default=0, help='Maximum records per file; default 0 runs all')
    p.add_argument('--case-id', action='append', help='Run only the specified case ID; repeat to select several')
    p.add_argument('--report', type=Path, default=ROOT / 'reports' / 'test_report.txt', help='Local text report path')
    p.add_argument('--validate-only', action='store_true', help='Check inputs without loading models')
    p.add_argument('--gpu-layers', type=int, default=None)
    a = p.parse_args()
    run_start = time.perf_counter()
    offline()
    runner = Runner(gpu_layers=a.gpu_layers)
    files = []
    for path in a.paths or [ROOT / 'tests' / 'cases']:
        files.extend(sorted(x for x in path.rglob('*') if x.suffix in ('.json', '.jsonl') and x.resolve() != a.report.resolve()) if path.is_dir() else [path])
    report = []
    try:
        for path in files:
            try:
                for i, row in enumerate(records(path)):
                    if a.case_id and row.get('id') not in a.case_id:
                        continue
                    if a.limit and i >= a.limit:
                        break
                    entry = {'file': str(path), 'record': i+1, 'case_id': row.get('id') if isinstance(row, dict) else None,
                             'review': row.get('review', []) if isinstance(row, dict) else [],
                             'reference': row.get('reference') if isinstance(row, dict) else None}
                    start = time.perf_counter()
                    try:
                        task = row.get('task_id', row.get('task'))
                        task = {'organize_notes': 'notes', 'section_outline': 'outline', 'rewrite_clarity': 'clarity', 'academic_tone': 'tone'}.get(task, task)
                        notes = row.get('notes')
                        if notes is not None:
                            task = task or 'notes'
                            text = '\n'.join(n['text'] for n in notes)
                        else:
                            text = row.get('text', row.get('input', ''))
                            if row.get('context'):
                                text += '\nContext:\n' + row['context']
                        entry.update(task=task, model=model_for(task), input=text, input_words=len(text.split()))
                        validate(task, text)
                        if a.validate_only or row.get('validation_only'):
                            entry['status'] = 'input_valid'
                        else:
                            previous_model = runner.model
                            prepare_start = time.perf_counter()
                            runner.load(task)
                            entry['model_reused'] = previous_model is not None and runner.model is previous_model
                            del previous_model
                            entry['gpu_layers'] = runner.actual_gpu_layers
                            entry['model_prepare_seconds'] = round(time.perf_counter() - prepare_start, 6)
                            inference_start = time.perf_counter()
                            def first_chunk(chunk):
                                if chunk and 'first_output_seconds' not in entry:
                                    entry['first_output_seconds'] = round(time.perf_counter() - inference_start, 6)
                            result = runner.run(task, text, emit=first_chunk, notes=notes)
                            inference_seconds = time.perf_counter() - inference_start
                            entry['inference_seconds'] = round(inference_seconds, 6)
                            entry['output_words'] = len(result.split())
                            entry['output_words_per_second'] = round(len(result.split()) / max(inference_seconds, 1e-9), 3)
                            entry.update(status='ok', task=task, output=result)
                            if task in ('clarity', 'tone'):
                                entry['unchanged_input'] = result.strip() == text.strip()
                            if 'output' in row:
                                entry['expected'] = row['output']
                                entry['exact_match'] = result.strip() == row['output'].strip()
                            entry['checks'] = evaluate_case(row, result)
                            if not all(entry['checks'].values()):
                                entry['status'] = 'quality_failed'
                        if row.get('expect_error'):
                            entry.update(status='failed', error='Expected input rejection, but request succeeded.')
                    except Exception as exc:
                        runner.close()
                        expected = row.get('expect_error') if isinstance(row, dict) else None
                        entry.update(status='expected_rejection' if expected and expected in str(exc) else 'error', error=str(exc))
                    entry['seconds'] = round(time.perf_counter()-start, 3)
                    report.append(entry)
                    a.report.parent.mkdir(parents=True, exist_ok=True)
                    a.report.write_text(text_report(report, time.perf_counter()-run_start, a.validate_only), encoding='utf-8')
                    print(f'{path.name}:{i+1} {entry["status"]}', flush=True)
            except Exception as exc:
                report.append({'file': str(path), 'status': 'error', 'error': str(exc)})
    except KeyboardInterrupt:
        print('Cancelled current case; its partial output was discarded.')
    finally:
        runner.close()
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(text_report(report, time.perf_counter() - run_start, a.validate_only), encoding='utf-8')
    print(f'Local report: {a.report.resolve()}')
    raise SystemExit(1 if not report or any(r['status'] in ('error', 'failed', 'quality_failed') for r in report) else 0)

if __name__ == '__main__':
    main()
