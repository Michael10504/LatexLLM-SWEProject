"""Dependency-free application and acceptance-check contracts."""
import json
import unittest
from unittest.mock import Mock, patch
from local_ai import ROOT, STRONG_MODEL, OUTLINE_MODEL, MENU, Runner, validate, protect, check_academic_voice, model_for
from test_run import evaluate_case

class Contracts(unittest.TestCase):
    def test_five_numbered_tasks(self):
        self.assertEqual(
            MENU,
            {
                '1': 'notes',
                '2': 'outline',
                '3': 'clarity',
                '4': 'tone',
                '5': 'grammar'
            }
        )

    def test_4b_reused_for_notes_clarity_tone(self):
        runner=Runner()
        model=Mock()
        runner.model=model
        runner.loaded_key=str(ROOT/STRONG_MODEL)
        runner.actual_gpu_layers=12
        for task in ('notes','clarity','tone'):
            runner.load(task)
            self.assertIs(runner.model,model)
        model.close.assert_not_called()

    def test_switching_models_unloads_previous_weights(self):
        runner=Runner()
        old=Mock()
        runner.model=old
        runner.loaded_key=str(ROOT/STRONG_MODEL)
        runner.actual_gpu_layers=12
        backend=Mock()
        backend.llama_supports_gpu_offload.return_value=True
        with patch.dict('sys.modules',{'llama_cpp':backend}), patch(
    'pathlib.Path.is_file',
    autospec=True,
    side_effect=lambda path: path.name != 'gpu_settings.json'
):
            runner.load('outline')
            old.close.assert_called_once()
            self.assertEqual(backend.Llama.call_args.kwargs['model_path'],str(ROOT/OUTLINE_MODEL))
            outline=runner.model
            runner.load('tone')
            outline.close.assert_called_once()
            self.assertEqual(backend.Llama.call_args.kwargs['model_path'],str(ROOT/STRONG_MODEL))

    def test_outline_requires_gpu_even_if_cpu_model_cached(self):
        runner=Runner(gpu_layers=0)
        runner.model=Mock()
        with self.assertRaisesRegex(RuntimeError,'requires GPU'):
            runner.load('outline')

    def test_outline_does_not_silently_fallback(self):
        backend=Mock()
        backend.llama_supports_gpu_offload.return_value=False
        with patch.dict('sys.modules',{'llama_cpp':backend}),patch(
    'pathlib.Path.is_file',
    autospec=True,
    side_effect=lambda path: path.name != 'gpu_settings.json'
):
            with self.assertRaisesRegex(RuntimeError,'requires GPU'):
                Runner().load('outline')
        backend.Llama.assert_not_called()

    def test_selection_boundaries(self):
        for task in MENU.values():
            with self.assertRaisesRegex(ValueError,'select text'): validate(task,' \n ')
            validate(task,'word '*1000)
            with self.assertRaisesRegex(ValueError,'1,000'): validate(task,'word '*1001)

    def test_empty_input_never_loads(self):
        runner=Runner(); runner.load=Mock()
        with self.assertRaises(ValueError): runner.run('notes','')
        runner.load.assert_not_called()

    def test_notes_list_cannot_bypass_limit(self):
        runner=Runner(); runner.load=Mock()
        with self.assertRaisesRegex(ValueError,'1,000'):
            runner.run('notes','short',notes=[{'text':'word '*1001}])
        runner.load.assert_not_called()

    def test_academic_voice(self):
        for text in ('I tested it.','We found a difference.','Our method may help.',"I've tested it."):
            with self.assertRaisesRegex(ValueError,'first-person'): check_academic_voice(text)
        check_academic_voice('The US sample included 20 participants.')
        check_academic_voice('The participant stated "I agree".')

    def test_latex_round_trip(self):
        text=r'Results $x=2$ follow \cite{smith} and \ref{fig:a}.'
        masked,spans=protect(text)
        self.assertEqual(len(spans),3)
        for i,span in enumerate(spans): masked=masked.replace(f'PROTECTEDSPAN{i:04d}END',span)
        self.assertEqual(masked,text)

    def test_generation_failure_returns_no_result(self):
        runner=Runner(); runner.load=Mock()
        def chunks(*args,**kwargs):
            yield {'choices':[{'text':'partial'}]}
            raise RuntimeError('backend failed')
        runner.model=Mock(side_effect=chunks); runner.model.tokenize.return_value=[1]
        seen=[]
        with self.assertRaisesRegex(RuntimeError,'backend failed'): runner.run('clarity','input',seen.append)
        self.assertEqual(seen,['partial'])

    def test_cancel_propagates(self):
        runner=Runner(); runner.load=Mock()
        runner.model=Mock(side_effect=KeyboardInterrupt); runner.model.tokenize.return_value=[1]
        with self.assertRaises(KeyboardInterrupt): runner.run('clarity','Selected text')

    def test_close_releases_model(self):
        runner=Runner(); model=Mock(); runner.model=model
        runner.close(); model.close.assert_called_once(); self.assertIsNone(runner.model)

    def test_checks_detect_changed_number(self):
        checks=evaluate_case({'text':'Informal 12% claim.','checks':{'preserve':['12%'],'must_change':True}},'The value was 21%.')
        self.assertFalse(checks["preserve '12%'"])
        self.assertTrue(checks['input was rewritten'])

    def test_note_checks_use_extracted_content(self):
        row={'text':'Long source paragraph.','checks':{'notes':True,'max_notes':2,'preserve':['24']}}
        good=json.dumps({'groups':[{'heading':'Method','notes':['24 samples were examined.']}]})
        self.assertTrue(all(evaluate_case(row,good).values()))

    def test_clear_prose_may_be_unchanged(self):
        self.assertEqual(evaluate_case({'text':'Already clear.','checks':{}},'Already clear.'),{})

    def test_outline_action_verbs_are_not_false_failures(self):
        row={'checks':{'outline':True,'writing_directions':True}}
        valid=json.dumps({'sections':[{'heading':'Interpretation','subsections':[
            'Interpret the return observations.', 'Distinguish observation from causation.']}]})
        self.assertTrue(all(evaluate_case(row,valid).values()))
        invalid=json.dumps({'sections':[{'heading':'Interpretation','subsections':['Return observations.']}]})
        self.assertFalse(evaluate_case(row,invalid)['actionable writing directions'])

    def test_grammar_empty_selection_never_loads_model(self):
        runner = Runner()
        runner.load = Mock()

        with self.assertRaisesRegex(ValueError, 'select text'):
            runner.run('grammar', '   \n ')

        runner.load.assert_not_called()

    def test_grammar_passes_selected_text_and_returns_suggestion(self):
        runner = Runner()
        runner.load = Mock()

        runner.model = Mock(return_value=[
            {'choices': [
                {
                    'text': 'She goes to university every day.',
                    'finish_reason': 'stop'
                }
            ]}
        ])
        runner.model.tokenize.return_value = [1]

        selected_text = 'She go to university every day.'
        result = runner.run('grammar', selected_text)

        runner.load.assert_called_once_with('grammar')

        sent_prompt = runner.model.call_args.args[0]
        self.assertIn(selected_text, sent_prompt)
        self.assertIn('Correct grammar', sent_prompt)

        self.assertEqual(
            result,
            'She goes to university every day.'
        )

if __name__=='__main__': unittest.main()

