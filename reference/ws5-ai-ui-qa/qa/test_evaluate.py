import contextlib
import csv
import io
import tempfile
import unittest
from pathlib import Path
from evaluate import FIELDS, initialize, summarize

class EvaluationTests(unittest.TestCase):
    def test_init_creates_blank_slots_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'reviews.csv'
            with contextlib.redirect_stdout(io.StringIO()):
                initialize(path)
            with path.open(encoding='utf-8-sig', newline='') as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 260)
            self.assertTrue(all(not r['reviewer_a_rating'] for r in rows))
            with self.assertRaises(SystemExit):
                initialize(path)

    def summary_for(self, rows):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'reviews.csv'
            with path.open('w', encoding='utf-8-sig', newline='') as f:
                w = csv.DictWriter(f, fieldnames=FIELDS)
                w.writeheader()
                w.writerows(rows)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                summarize(path)
            return output.getvalue()

    def row(self, i, **overrides):
        row = dict.fromkeys(FIELDS, '')
        row.update(case_id=f'grammar-{i}', task='grammar', input_or_paper_path='input.txt',
                   expected_checks='preserve meaning', run_type='real', actual_output_path='output.txt',
                   evidence_path='evidence.txt', reviewer_a_name='Reviewer A', reviewer_b_name='Reviewer B',
                   reviewer_a_rating='usable', reviewer_b_rating='minor_edits')
        row.update(overrides)
        return row

    def test_eighty_percent_requires_both_reviewers(self):
        rows = [self.row(i, reviewer_b_rating='unusable' if i < 6 else 'minor_edits') for i in range(30)]
        self.assertIn('grammar: reviewed=30/30, both usable=24, rate=80.0%, PASS', self.summary_for(rows))

    def test_stub_incomplete_and_same_reviewer_do_not_count(self):
        rows = [self.row(1, run_type='stub'), self.row(2, reviewer_b_rating=''),
                self.row(3, reviewer_b_name='Reviewer A')]
        self.assertIn('grammar: reviewed=0/30, both usable=0, rate=N/A, INCOMPLETE', self.summary_for(rows))

if __name__ == '__main__':
    unittest.main()
