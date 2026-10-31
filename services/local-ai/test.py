"""Run JSON/JSONL case files with the active local AI; save readable responses.

Examples (run from this folder):
    python test.py
    python test.py test_cases/06_grammar.json
    python test.py --validate-only
    python test.py --case-id grammar-connected-paragraphs --report my_responses.txt
"""
import argparse
from collections import Counter
from datetime import datetime
import json
from pathlib import Path
import time

from local_ai import ROOT, Runner, model_for, offline, validate
from test_requirements import evaluate_case

ALIASES = {
    'organize_notes': 'notes', 'section_outline': 'outline',
    'rewrite_clarity': 'clarity', 'academic_tone': 'tone', 'grammar_check': 'grammar',
}


def records(path):
    """Accept an array, a single case, {requests: [...]}, or JSONL."""
    with path.open(encoding='utf-8-sig') as stream:
        if path.suffix.lower() == '.jsonl':
            for line in stream:
                if line.strip():
                    yield json.loads(line)
        else:
            data = json.load(stream)
            if isinstance(data, dict) and 'requests' in data:
                data = data['requests']
            yield from data if isinstance(data, list) else [data]


def save_report(path, results, validation_only):
    lines = ['LOCAL AI JSON CASE RESPONSES', datetime.now().astimezone().isoformat(),
             'Runtime: active local_ai.py and runtime/; no archived Python is executed.',
             'Mode: ' + ('validation only; no model invoked' if validation_only else 'real local inference'),
             'Statuses: ' + ', '.join(f'{name}={count}' for name, count in sorted(Counter(row['status'] for row in results).items())),
             'Automatic checks are supplementary, not human or AI semantic quality ratings.', '']
    for row in results:
        lines += ['=' * 72, f"{row['id']} | {row['task']} | {row['status']}",
                  'Source JSON: ' + row['file'], 'Record: ' + str(row['record']),
                  'INPUT:', row.get('input', ''), '', 'MODEL RESPONSE:',
                  row.get('output', '(No completed response: validation-only, rejected, cancelled, or failed.)')]
        for key in ('error', 'model', 'gpu_layers', 'seconds', 'first_output_seconds'):
            if key in row:
                lines.append(f'{key}: {row[key]}')
        if row.get('checks'):
            lines += ['CHECKS:'] + [f"{'PASS' if passed else 'FAIL'}: {check}" for check, passed in row['checks'].items()]
        if row.get('review'):
            lines += ['SEMANTIC REVIEW CRITERIA:'] + row['review']
        if row.get('reference'):
            lines += ['ILLUSTRATIVE REFERENCE (not an exact-match target):', row['reference']]
        lines.append('')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text('\n'.join(lines), encoding='utf-8')
    temporary.replace(path)


def run_case(row, runner, validation_only=False):
    """Validation failures are handled before loading/invoking the model."""
    if not isinstance(row, dict):
        raise ValueError('Each case must be a JSON object.')
    task = row.get('task_id', row.get('task', ''))
    task = ALIASES.get(str(task).lower(), str(task).lower())
    text = row.get('text', row.get('input', ''))
    result = {'id': row.get('id', 'unnamed'), 'task': task,
              'input': text if isinstance(text, str) else repr(text),
              'review': row.get('review', []), 'reference': row.get('reference')}
    start = time.perf_counter()
    try:
        try:
            validate(task, text)
        except ValueError as exc:
            expected = row.get('expect_error')
            result.update(status='expected_rejection' if isinstance(expected, str) and expected in str(exc) else 'error', error=str(exc))
            return result
        # An expected INPUT rejection must not accidentally invoke the model.
        if row.get('expect_error'):
            result.update(status='failed', error='Expected input rejection, but validation accepted the request.')
            return result
        if validation_only or row.get('validation_only'):
            result['status'] = 'input_valid'
            return result
        first = []
        def emit(token):
            if token and not first:
                first.append(time.perf_counter() - start)
        output = runner.run(task, text, emit=emit)
        # Retain completed output even if an acceptance checker subsequently fails.
        result.update(output=output, model=model_for(task), gpu_layers=runner.actual_gpu_layers)
        if first:
            result['first_output_seconds'] = first[0]
        checks = evaluate_case(dict(row, text=text), output)
        result.update(checks=checks, status='ok' if all(checks.values()) else 'quality_failed')
    except Exception as exc:
        runner.close()
        result.update(status='error', error=str(exc))
    finally:
        result['seconds'] = round(time.perf_counter() - start, 6)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='*', type=Path, help='JSON/JSONL files or folders; default: test_cases/')
    parser.add_argument('--report', type=Path, default=ROOT / 'test_responses.txt')
    parser.add_argument('--validate-only', action='store_true', help='Check every input without loading models')
    parser.add_argument('--case-id', action='append', help='Run one case ID; repeat for several')
    parser.add_argument('--limit', type=int, default=0, help='Maximum selected cases per file; 0 means all')
    parser.add_argument('--gpu-layers', type=int, default=None, help='Automatic fit by default; 0 for CPU, N for maximum GPU layers')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit must be nonnegative')
    if args.report.suffix.lower() != '.txt':
        parser.error('--report must be a .txt file')
    if args.report.resolve() == (ROOT / 'requirements_report.txt').resolve():
        parser.error('Choose a separate response report; requirements_report.txt is reserved for the acceptance suite.')
    files = []
    for path in args.paths or [ROOT / 'test_cases']:
        files.extend(sorted(item for item in path.rglob('*') if item.suffix.lower() in ('.json', '.jsonl')) if path.is_dir() else [path])
    files = list(dict.fromkeys(path.resolve() for path in files))
    if not files:
        parser.error('No JSON/JSONL case files found.')
    if args.report.resolve() in files:
        parser.error('The output report cannot overwrite an input case file.')
    offline()
    runner = Runner(gpu_layers=args.gpu_layers)
    results = []
    try:
        for path in files:
            selected = 0
            try:
                for index, row in enumerate(records(path), 1):
                    if args.case_id and (not isinstance(row, dict) or row.get('id') not in args.case_id):
                        continue
                    if args.limit and selected >= args.limit:
                        break
                    selected += 1
                    try:
                        result = run_case(row, runner, args.validate_only)
                    except KeyboardInterrupt:
                        result = {'id': row.get('id', 'unnamed') if isinstance(row, dict) else 'invalid',
                                  'task': row.get('task_id', row.get('task', '')) if isinstance(row, dict) else '',
                                  'status': 'cancelled', 'error': 'Partial response discarded.'}
                        result.update(file=str(path), record=index)
                        results.append(result)
                        raise
                    except Exception as exc:
                        result = {'id': 'invalid', 'task': '', 'status': 'error', 'error': str(exc)}
                    result.update(file=str(path), record=index)
                    results.append(result)
                    save_report(args.report, results, args.validate_only)
                    print(f"{path.name}:{index} {result['id']} {result['status']}", flush=True)
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                results.append({'id': 'file_error', 'task': '', 'file': str(path), 'record': 0,
                                'status': 'error', 'error': str(exc)})
    except KeyboardInterrupt:
        print('Cancelled; completed responses are retained, partial response discarded.')
    finally:
        runner.close()
        if not results:
            results.append({'id': 'selection', 'task': '', 'file': ', '.join(map(str, files)),
                            'record': 0, 'status': 'failed', 'error': 'No cases matched the requested selection.'})
        save_report(args.report, results, args.validate_only)
    print('Saved responses:', args.report.resolve())
    return 1 if not results or any(row['status'] in ('error', 'failed', 'quality_failed', 'cancelled') for row in results) else 0


if __name__ == '__main__':
    raise SystemExit(main())
