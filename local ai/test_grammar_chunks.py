"""Fake-model structural tests: no model download or GPU required."""
import re
import unittest
from unittest.mock import Mock
from local_ai import Runner, grammar_parts

class FakeModel:
    def __init__(self, transform=lambda text: text, finish=None):
        self.transform, self.finish, self.calls = transform, finish, []
    def tokenize(self, value):
        return [1] * 10
    def __call__(self, prompt, **options):
        source = prompt.rsplit('<|im_start|>user\n', 1)[1].split('\n/no_think', 1)[0]
        self.calls.append(source)
        for char in self.transform(source):
            yield {'choices': [{'text': char}]}
        if self.finish:
            yield {'choices': [{'text': '', 'finish_reason': self.finish}]}

class GrammarChunks(unittest.TestCase):
    def runner(self, model=None):
        runner = Runner()
        runner.model = model or FakeModel()
        runner.load = Mock()
        return runner
    def test_abbreviations_initials_decimals(self):
        text = 'Dr. A. Smith measured 3.14 units in Fig. 2. Results were uncertain.'
        self.assertEqual(grammar_parts(text), ['Dr. A. Smith measured 3.14 units in Fig. 2.', ' ', 'Results were uncertain.'])
    def test_latex_not_split(self):
        text = r'Use $x. y$ and \begin{equation}a. b\end{equation}. Next sentence.'
        parts = grammar_parts(text)
        self.assertEqual(len(parts), 3)
        self.assertEqual(''.join(parts), text)
    def test_whitespace(self):
        text = '  First sentence.\r\n\r\nSecond sentence.  '
        self.assertEqual(self.runner().run('grammar', text), text)
    def test_stream_restores_fragmented_tokens(self):
        source = r'The equation $E=mc^2$ is cited in \cite{key}.'
        pieces = []
        result = self.runner().run('grammar', source, pieces.append)
        self.assertEqual(result, source)
        self.assertEqual(''.join(pieces), result)
        self.assertNotIn('PROTECTEDSPAN', ''.join(pieces))
        self.assertGreater(len(pieces), 2)
    def test_stream_before_second_sentence(self):
        runner = self.runner()
        counts = []
        runner.run('grammar', 'First sentence. Second sentence.', lambda p: counts.append(len(runner.model.calls)))
        self.assertEqual(len(runner.model.calls), 2)
        self.assertEqual(counts[0], 1)
    def test_word_limit_before_load(self):
        runner = self.runner()
        with self.assertRaisesRegex(ValueError, '1,000'):
            runner.run('grammar', 'word ' * 1001)
        runner.load.assert_not_called()
    def test_empty_before_load(self):
        runner = self.runner()
        with self.assertRaises(ValueError):
            runner.run('grammar', ' \n ')
        runner.load.assert_not_called()
    def test_missing_token(self):
        runner = self.runner(FakeModel(lambda t: re.sub(r'PROTECTEDSPAN\d+END', '', t)))
        with self.assertRaisesRegex(ValueError, 'protected LaTeX'):
            runner.run('grammar', 'Use $x$ here.')
    def test_duplicate_token(self):
        runner = self.runner(FakeModel(lambda t: t + ' PROTECTEDSPAN0000END'))
        with self.assertRaisesRegex(ValueError, 'protected LaTeX'):
            runner.run('grammar', 'Use $x$ here.')
    def test_truncation(self):
        runner = self.runner(FakeModel(finish='length'))
        with self.assertRaisesRegex(ValueError, 'token limit'):
            runner.run('grammar', 'First sentence. Second sentence.')
        self.assertEqual(len(runner.model.calls), 1)
    def test_interrupt_stops_remaining_sentences(self):
        runner = self.runner()
        def cancel(piece):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            runner.run('grammar', 'First sentence. Second sentence.', cancel)
        self.assertEqual(len(runner.model.calls), 1)
    def test_other_tasks_unchanged(self):
        for task in ('clarity', 'tone'):
            runner = self.runner()
            text = 'First sentence. Second sentence.'
            self.assertEqual(runner.run(task, text), text)
            self.assertEqual(runner.model.calls, [text])
    def test_capacity(self):
        runner = self.runner()
        runner.context = 1
        with self.assertRaisesRegex(ValueError, 'token capacity'):
            runner.run('grammar', 'A sentence.')
        self.assertEqual(runner.model.calls, [])
    def test_1000_words_with_fake_model(self):
        text = ' '.join(['word'] * 1000)
        self.assertEqual(self.runner().run('grammar', text), text)

if __name__ == '__main__':
    unittest.main()
