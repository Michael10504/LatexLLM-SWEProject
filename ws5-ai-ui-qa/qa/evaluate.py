"""Local human-review workbook helper. Does not generate prompts, outputs, or ratings."""
import argparse
import csv
from pathlib import Path

GROUPS = ['notes', 'outline', 'clarity', 'tone', 'grammar', 'table', 'caption', 'latex', 'summary']
FIELDS = ['case_id', 'task', 'input_or_paper_path', 'expected_checks', 'run_type',
          'actual_output_path', 'reviewer_a_name', 'reviewer_a_rating',
          'reviewer_b_name', 'reviewer_b_rating', 'evidence_path', 'notes']
RATINGS = {'usable', 'minor_edits', 'unusable'}
GOOD = {'usable', 'minor_edits'}

def initialize(path):
    if path.exists():
        raise SystemExit('File exists; refusing to overwrite review work.')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for task in GROUPS:
            for i in range(1, (20 if task == 'summary' else 30) + 1):
                writer.writerow({'case_id': f'{task}-{i:02}', 'task': task})
    print('Created 260 BLANK case slots. No prompts, papers, runs, or ratings have been completed.')

def summarize(path):
    with path.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != FIELDS:
            raise SystemExit('Unexpected CSV columns. Keep the original header order.')
        rows = list(reader)
    ids = [r['case_id'].strip() for r in rows]
    if not all(ids) or len(ids) != len(set(ids)):
        raise SystemExit('Case IDs must be nonempty and unique.')
    if any(r['task'] not in GROUPS for r in rows):
        raise SystemExit('Unknown task group.')
    for group in GROUPS:
        subset = [r for r in rows if r['task'] == group]
        reviewed = []
        for r in subset:
            for field in ['reviewer_a_rating', 'reviewer_b_rating']:
                if r[field] and r[field] not in RATINGS:
                    raise SystemExit(f"{r['case_id']}: invalid rating {r[field]!r}")
            if (r['run_type'] == 'real' and r['input_or_paper_path'].strip()
                and r['expected_checks'].strip() and r['actual_output_path'].strip()
                and r['evidence_path'].strip() and r['reviewer_a_name'].strip()
                and r['reviewer_b_name'].strip()
                and r['reviewer_a_name'].strip().casefold() != r['reviewer_b_name'].strip().casefold()
                and r['reviewer_a_rating'] in RATINGS and r['reviewer_b_rating'] in RATINGS):
                reviewed.append(r)
        passed = sum(r['reviewer_a_rating'] in GOOD and r['reviewer_b_rating'] in GOOD for r in reviewed)
        target = 20 if group == 'summary' else 30
        percent = f'{100 * passed / len(reviewed):.1f}%' if reviewed else 'N/A'
        state = 'INCOMPLETE' if len(reviewed) < target else ('PASS' if passed / len(reviewed) >= .8 else 'FAIL')
        print(f'{group}: reviewed={len(reviewed)}/{target}, both usable={passed}, rate={percent}, {state}')
    print('Checks record completeness, not truth of evidence or independent review; inspect supporting files.')

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['init', 'summary'])
    p.add_argument('csv_path', type=Path)
    a = p.parse_args()
    initialize(a.csv_path) if a.command == 'init' else summarize(a.csv_path)
