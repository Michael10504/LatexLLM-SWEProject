"""Single entry point for unit checks, model quality and numerical performance tests."""

import argparse
import contextlib
import datetime
import hashlib
import io
import math
import os
import re
from pathlib import Path
import statistics
import subprocess
import sys
import time
import unittest

from local_ai import ROOT, Runner, TASKS, model_for, offline

REQUIREMENTS = {
 'FR-03.1': 'Sprint 1 shall provide exactly five tasks: organize notes, section outline, clarity rewrite, academic tone, grammar. Tasks 6-8 are deferred to Sprint 2.',
 'FR-03.2': 'For Tasks 1-5 use only the selected text supplied by the editor/caller. Empty or whitespace-only selection shall ask the user to select text and shall not invoke the model.',
 'FR-03.3': 'DEFERRED to Sprint 2 with Task 8 and compile-log integration.',
 'FR-03.4': 'All local AI tasks shall execute on the user device and shall never send their input/output to external destinations, regardless of Local Only mode. In-process inference is allowed; a server is not required.',
 'FR-03.5': 'Reject selected input above 1000 words and ask for a smaller selection before model invocation.',
 'FR-03.6': 'REMOVED at user request. Existing preview/Ctrl+C support may remain, but is not an acceptance requirement.',
 'FR-03.7': 'If a model is unavailable or fails, display a clear error, discard its result, and leave the source document unchanged.',
 'NFR-04': 'On the reference test machine, using automatic GPU/CPU offloading, warm first-token p95 shall be <=15.0 seconds, median output generation >=2.0 tokens/second, and exact 150-word clarity rewrite p95 <=60.0 seconds. Cold load-to-first-token shall be <=30.0 seconds with loading status. Verify >=20 measured warm runs, excluding the cold/warmup run, and record hardware and offloading configuration.',
 'NFR-06': 'Choose the largest estimated layer count fitting current free VRAM and the 1.5GB decimal AI budget (1430 MiB conservative limit) on a 2GB target GPU. Context <=4096; leave 256 MiB device headroom. Remaining layers/KV cache run on CPU; use CPU-only if GPU unavailable/insufficient. CPU execution requires enough system RAM; report actual success rather than assuming speed or RAM sufficiency. Estimates and sampled memory checks do not impose a driver-level quota.',
 'NFR-07': 'For Sprint 1, evaluate 30 development prompts for each of Tasks 1-5 (150 total). A designated reviewer, explicitly identified as human or AI-assisted, shall compare each output against its input. At least 24/30 per task shall be usable unchanged or after <=10% word edits without changing meaning. Record corrections, edit counts, omissions and unsupported claims. AI-only ratings are provisional and do not establish the superseded two-independent-human-reviewer condition.',
}

def evaluate_case(row, result):
    """Explicit checks only; semantic quality still needs manual review."""
    checks = {}
    rules = row.get('checks', {})
    for literal in rules.get('preserve', []):
        checks[f'preserve {literal!r}'] = preserves_literal_or_integer(literal,result)
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


# Consolidated from test_runtime.py

"""Dependency-free application and acceptance-check contracts."""
import json
import unittest
from unittest.mock import Mock, patch
from local_ai import ROOT, STRONG_MODEL, OUTLINE_MODEL, MENU, Runner, validate, protect, check_academic_voice, model_for


class Contracts(unittest.TestCase):
    def test_four_numbered_tasks(self):
        self.assertEqual(MENU, {'1':'notes','2':'outline','3':'clarity','4':'tone','5':'grammar'})

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
        from runtime.vram_policy import OffloadPlan
        with patch.dict('sys.modules',{'llama_cpp':backend}), patch('pathlib.Path.is_file',return_value=True), \
             patch('runtime.vram_policy.choose_offload',return_value=OffloadPlan()):
            runner.load('outline')
            old.close.assert_called_once()
            self.assertEqual(backend.Llama.call_args.kwargs['model_path'],str(ROOT/OUTLINE_MODEL))
            outline=runner.model
            runner.load('tone')
            outline.close.assert_called_once()
            self.assertEqual(backend.Llama.call_args.kwargs['model_path'],str(ROOT/STRONG_MODEL))

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

    def test_gpu_load_failure_retries_on_cpu(self):
        from runtime.vram_policy import OffloadPlan
        backend=Mock(); backend.llama_supports_gpu_offload.return_value=True
        cpu=Mock(); backend.Llama.side_effect=[RuntimeError('GPU OOM'),cpu]
        runner=Runner()
        with patch.dict('sys.modules',{'llama_cpp':backend}), patch('pathlib.Path.is_file',return_value=True), \
             patch('runtime.vram_policy.choose_offload',return_value=OffloadPlan(gpu_layers=8)):
            runner.load('clarity')
        self.assertEqual([call.kwargs['n_gpu_layers'] for call in backend.Llama.call_args_list],[8,0])
        self.assertEqual([call.kwargs['op_offload'] for call in backend.Llama.call_args_list],[True,False])
        self.assertEqual(runner.actual_gpu_layers,0)
        self.assertIs(runner.model,cpu)

    def test_vram_changes_during_load_retry_cpu(self):
        from runtime.vram_policy import OffloadPlan
        backend=Mock(); backend.llama_supports_gpu_offload.return_value=True
        gpu=Mock(); cpu=Mock(); backend.Llama.side_effect=[gpu,cpu]
        runner=Runner()
        with patch.dict('sys.modules',{'llama_cpp':backend}), patch('pathlib.Path.is_file',return_value=True), \
             patch('runtime.vram_policy.choose_offload',return_value=OffloadPlan(gpu_layers=8)), \
             patch.object(runner,'_gpu_memory_ok',return_value=False):
            runner.load('clarity')
        gpu.close.assert_called_once()
        self.assertEqual(runner.actual_gpu_layers,0)
        self.assertIs(runner.model,cpu)

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





# Consolidated from test_service.py

import unittest
from unittest.mock import Mock
from runtime.ai_service import *

class ServiceTests(unittest.TestCase):
    def test_boundaries_and_roles_never_invoke_model(self):
        for role, text, error in [('VIEWER', 'text', PermissionError),
                                  ('EDITOR', '', ValueError), ('EDITOR', 'word '*1001, ValueError)]:
            adapter = Mock()
            with self.assertRaises(error):
                AITaskService(adapter).run(SelectionTask('clarity', text), role)
            adapter.generate.assert_not_called()
            adapter.isAvailable.assert_not_called()
    def test_all_five_and_status(self):
        for task in PROMPTS:
            states = []
            service = AITaskService(StubModelAdapter())
            self.assertEqual(service.run(SelectionTask(task, 'selected'), 'EDITOR', status=states.append), 'Recorded response.')
            self.assertEqual(states, ['loading', 'generating', 'idle'])
    def test_cancel_discards(self):
        service = AITaskService(StubModelAdapter())
        with self.assertRaises(InterruptedError):
            service.run(SelectionTask('clarity', 'source'), 'OWNER', lambda token: service.cancel())
        self.assertEqual(service.preview, '')
    def test_failure_discards(self):
        adapter = Mock()
        def broken(messages):
            yield 'partial'
            raise RuntimeError('OOM')
        adapter.generate.side_effect = broken
        service = AITaskService(adapter)
        with self.assertRaises(RuntimeError):
            service.run(SelectionTask('grammar', 'source'), 'EDITOR')
        self.assertEqual(service.preview, '')
    def test_loopback(self):
        for url in ['https://example.com', 'http://localhost:8080/v1/chat/completions', 'http://[::1]:8080/v1/chat/completions']:
            with self.assertRaises(ValueError): LlamaCppAdapter(url)
    def test_registry(self):
        self.assertEqual(ModelRegistry().get('shared')['context'], 4096)


# Consolidated from test_loopback.py

"""Real socket integration tests against an isolated loopback protocol fixture.

This fixture tests transport and failures; it is not a llama.cpp performance test.
"""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from runtime.ai_service import AITaskService, SelectionTask, LlamaCppAdapter

class Handler(BaseHTTPRequestHandler):
    mode = 'ok'
    received = None
    def log_message(self, *args):
        pass
    def do_GET(self):
        self.send_response(503 if self.mode == 'unavailable' else 200)
        self.end_headers()
    def do_POST(self):
        Handler.received = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.mode == 'oom':
            self.send_response(500); self.end_headers(); return
        self.send_response(200); self.end_headers()
        if self.mode == 'redirect':
            return
        if self.mode == 'malformed':
            self.wfile.write(b'data: not-json\n\n'); return
        for text in ('Real ', 'socket stream.'):
            self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\n').encode())
            self.wfile.flush()
        if self.mode != 'disconnect':
            self.wfile.write(b'data: [DONE]\n\n')

class LoopbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1',8080),Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
    def setUp(self):
        Handler.mode='ok'
    def test_real_stream_all_tasks_selection_only(self):
        for task in ('notes','outline','clarity','tone','grammar'):
            service=AITaskService(LlamaCppAdapter())
            seen=[]
            self.assertEqual(service.run(SelectionTask(task,'ONLY SELECTED'), 'EDITOR', seen.append), 'Real socket stream.')
            self.assertEqual(seen,['Real ','socket stream.'])
            self.assertEqual(Handler.received['messages'][1]['content'],'ONLY SELECTED\n/no_think')
    def test_real_failures_clear_preview(self):
        for mode in ('unavailable','oom','malformed','disconnect'):
            with self.subTest(mode=mode):
                Handler.mode=mode
                service=AITaskService(LlamaCppAdapter(timeout=1))
                with self.assertRaises(RuntimeError):
                    service.run(SelectionTask('clarity','source'), 'EDITOR')
                self.assertEqual(service.preview,'')
    def test_real_cancel_and_recovery(self):
        service=AITaskService(LlamaCppAdapter())
        with self.assertRaises(InterruptedError):
            service.run(SelectionTask('clarity','source'),'EDITOR',lambda token:service.cancel())
        self.assertEqual(service.preview,'')
        self.assertEqual(service.run(SelectionTask('clarity','next'),'EDITOR'),'Real socket stream.')


# Consolidated from test_vram_policy.py

import unittest
from unittest.mock import patch
from runtime.vram_policy import permitted_layers, choose_offload, estimate_mib, CAP_MIB, tensor_layout
import struct
import tempfile
from pathlib import Path
from local_ai import Runner

class VRAMPolicy(unittest.TestCase):
    def test_no_verified_profile_uses_cpu(self):
        self.assertEqual(permitted_layers(12, {}), 0)

    def test_budget_and_free_memory(self):
        for peak, free, expected in [(1431, 2048, 0), (1430, 1685, 0),
                                     (1430, None, 0), (1430, 1686, 12)]:
            with self.subTest(peak=peak, free=free), patch('runtime.vram_policy.free_vram', return_value=free):
                self.assertEqual(permitted_layers(12, {'verified_vram_profile': {
                    'peak_mib': peak, 'gpu_layers': 12, 'nvidia_uuid': 'GPU-test'}}), expected)

    def test_context_cap(self):
        with self.assertRaises(ValueError):
            Runner(context=4097)

class AutoOffloadTests(unittest.TestCase):
    layout={'blocks':[100*1024*1024]*12,'output_bytes':100*1024*1024}
    def plan(self,free,requested=None,supported=True):
        memory={'uuid':'GPU-test','total_mib':2048,'used_mib':2048-free,'free_mib':free}
        with patch('runtime.vram_policy.gpu_memory',return_value=memory), patch('runtime.vram_policy.tensor_layout',return_value=self.layout):
            return choose_offload('model.gguf',requested,supported=supported)

    def test_uses_largest_fit_under_module_budget(self):
        plan=self.plan(2048)
        self.assertEqual(plan.gpu_layers,10)
        self.assertLessEqual(plan.estimated_mib,CAP_MIB)
        self.assertGreater(estimate_mib(self.layout,plan.gpu_layers+1),CAP_MIB)

    def test_less_free_memory_reduces_gpu_layers(self):
        self.assertEqual(self.plan(1000).gpu_layers,3)
        self.assertEqual(self.plan(600).gpu_layers,0)

    def test_explicit_max_cpu_and_full_remain_budgeted(self):
        self.assertEqual(self.plan(2048,requested=4).gpu_layers,4)
        self.assertEqual(self.plan(2048,requested=0).gpu_layers,0)
        self.assertEqual(self.plan(2048,requested=-1).gpu_layers,10)

    def test_full_offload_when_small_model_fits(self):
        with patch('runtime.vram_policy.gpu_memory',return_value={'uuid':'GPU-test','used_mib':200,'free_mib':1800}), \
             patch('runtime.vram_policy.tensor_layout',return_value={'blocks':[10*1024*1024]*4,'output_bytes':10*1024*1024}):
            self.assertEqual(choose_offload('small.gguf').gpu_layers,5)

    def test_unknown_telemetry_or_backend_uses_cpu(self):
        with patch('runtime.vram_policy.gpu_memory',return_value=None):
            self.assertEqual(choose_offload('model.gguf').gpu_layers,0)
        self.assertEqual(self.plan(2048,supported=False).gpu_layers,0)

    def test_invalid_model_falls_back_and_invalid_request_rejected(self):
        with patch('runtime.vram_policy.gpu_memory',return_value={'uuid':'GPU-test','used_mib':0,'free_mib':2048}), \
             patch('runtime.vram_policy.tensor_layout',side_effect=ValueError('bad model')):
            self.assertEqual(choose_offload('bad.gguf').gpu_layers,0)
        with self.assertRaises(ValueError): self.plan(2048,requested=-2)

    def test_reads_known_gguf_offsets(self):
        def string(value):
            raw=value.encode(); return struct.pack('<Q',len(raw))+raw
        header=b'GGUF'+struct.pack('<IQQ',3,3,0)
        entries=b''
        for name,offset in [('blk.0.weight',0),('blk.1.weight',32),('output.weight',64)]:
            entries+=string(name)+struct.pack('<IQIQ',1,8,0,offset)
        data=header+entries
        data+=b'\0'*((-len(data))%32)+b'\0'*96
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'tiny.gguf'; path.write_bytes(data)
            self.assertEqual(tensor_layout(path),{'blocks':[32,32],'output_bytes':32})

class RevisedRequirementTests(unittest.TestCase):
    def test_fr02_notes_cannot_replace_selected_text(self):
        runner=Runner(); runner.load=Mock()
        with self.assertRaisesRegex(ValueError,'selected text'):
            runner.run('notes','Actual selection',notes=[{'text':'Other content'}])
        runner.load.assert_not_called()

    def test_fr04_inference_blocks_external_and_loopback_sockets(self):
        program = '''from local_ai import offline
import socket
offline()
for host in ('127.0.0.1', '192.0.2.1', 'example.com'):
    try:
        socket.create_connection((host, 443), timeout=.1)
    except OSError as exc:
        assert 'disabled' in str(exc)
    else:
        raise AssertionError('Network connection allowed')
print('All attempted socket connections blocked before network access')
'''
        result=subprocess.run([sys.executable,'-c',program],cwd=ROOT,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_fr07_cli_error_and_source_unchanged(self):
        import local_ai
        source='The selected source must remain unchanged.'
        for error in (FileNotFoundError('Model unavailable'),RuntimeError('Model failed: OOM')):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                document=Path(folder)/'document.tex'; document.write_text(source,encoding='utf-8')
                runner=Mock(); runner.run.side_effect=error
                captured=io.StringIO()
                with patch('local_ai.Runner',return_value=runner), patch('local_ai.offline'), \
                     patch('sys.argv',['local_ai.py']), patch('builtins.input',side_effect=['3',source,'.end','q']), \
                     contextlib.redirect_stdout(captured):
                    local_ai.main()
                self.assertIn('Error:',captured.getvalue())
                self.assertIn('Result discarded; document unchanged.',captured.getvalue())
                self.assertEqual(document.read_text(encoding='utf-8'),source)


REPORT = ROOT/'requirements_report.txt'
STATE_START = '\n=== MACHINE-READABLE RESULTS ===\n'
STATE_END = '\n=== END RESULTS ===\n'
TOPICS = ['library','workshop','classroom','laboratory','archive','museum','clinic',
          'transport','housing','energy','water','forest','coastal','agricultural',
          'software','database','network','robotics','materials','optical',
          'acoustic','chemical','biological','geological','economic','linguistic',
          'historical','educational','statistical','astronomical']

def preserves_literal_or_integer(literal,result):
    """Integer quantities may be spelled out; other protected literals stay exact."""
    if not re.fullmatch(r'\d+',literal) or not 0<=int(literal)<100:
        return literal in result
    if re.search(r'(?<!\w)'+re.escape(literal)+r'(?!\w)',result): return True
    small=['zero','one','two','three','four','five','six','seven','eight','nine',
           'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
    tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
    number=int(literal)
    words=small[number] if number<20 else tens[number//10]+(('[- ]'+small[number%10]) if number%10 else '')
    return re.search(r'\b'+words+r'\b',result,re.I) is not None

def quality_cases():
    """30 unique synthetic development prompts per task, never training data."""
    cases=[]
    for task in TASKS:
        for index,topic in enumerate(TOPICS):
            number=str(12+index)
            if task=='notes':
                text=f'The {topic} pilot involved {number} participants. Findings were preliminary; causality was not established.'
                checks={'notes':True,'max_notes':4,'preserve':[number]}
            elif task=='outline':
                text=f'A {topic} pilot examined {number} records. Its small sample limited generalizability.'
                checks={'outline':True,'writing_directions':True,'max_sections':3,'preserve':[number]}
            elif task=='clarity':
                text=f'Due to the fact that the {topic} pilot included only {number} records, conclusions remain preliminary.'
                checks={'preserve':[number],'must_change':True}
            elif task=='tone':
                text=f'We checked {number} {topic} records, but we cannot generalize our findings.'
                checks={'preserve':[number],'must_change':True,'forbid_regex':[r'\b(?:I|[Ww]e|[Oo]ur)\b']}
            else:
                text=f'The {number} {topic} records was checked, but the findings is preliminary.'
                checks={'preserve':[number],'must_change':True,'forbid_regex':[r'\brecords was\b',r'\bfindings is\b']}
            cases.append({'id':f'{task}-{index+1:02d}','task':task,'text':text,'checks':checks})
    return cases

def load_state():
    if REPORT.exists():
        content=REPORT.read_text(encoding='utf-8')
        if STATE_START in content:
            return json.loads(content.split(STATE_START,1)[1].split(STATE_END,1)[0])
    return {'quality':[],'units':{},'performance':{},'quality_dataset':'150 short synthetic development cases; not Member 5 validated prompts'}

def word_edits(original, corrected):
    """Word-level insertions/deletions/substitutions, measured against model output."""
    before,after=original.split(),corrected.split()
    previous=list(range(len(after)+1))
    for index,left in enumerate(before,1):
        current=[index]
        for other,right in enumerate(after,1):
            current.append(min(current[-1]+1,previous[other]+1,previous[other-1]+(left!=right)))
        previous=current
    return previous[-1],len(before)

def jointly_usable(row):
    ratings=row.get('reviewers',{})
    return len(ratings)==2 and all(rating['meaning_preserved'] and rating['output_words']>0
        and rating['word_edits']/rating['output_words']<=.1 for rating in ratings.values())

def ai_usable(row):
    rating=row.get('ai_review',{})
    if not rating.get('usable_with_at_most_minor_edits',False): return False
    edits,words=word_edits(row.get('output',''),rating.get('suggested_corrected_output',''))
    return words>0 and edits/words<=.1

def numerical_performance_result(data):
    warm=[row for row in data.get('rows',[]) if row.get('measured_warm')]
    cold=[row for row in data.get('rows',[]) if row.get('cold_warmup')]
    if len(warm)<20 or len(cold)!=1 or len(data.get('input','').split())!=150:
        return {'status':'NOT VERIFIED: requires one cold run and >=20 warm 150-word runs'}
    if any(row.get('decode_tokens',0)<=0 or row.get('seconds',0)<=row.get('ttft',0) for row in warm):
        return {'status':'NOT VERIFIED: missing or invalid backend token counts/timings'}
    p95=lambda values:sorted(values)[math.ceil(.95*len(values))-1]
    metrics={'p95_ttft':p95([row['ttft'] for row in warm]),
             'median_output_tokens_per_second':statistics.median(row['decode_tokens']/(row['seconds']-row['ttft']) for row in warm),
             'median_native_decode_tokens_per_second':statistics.median(row['decode_tokens_per_second'] for row in warm),
             'p95_rewrite_seconds':p95([row['seconds'] for row in warm]),
             'cold_first_token':cold[0]['ttft'],'measured_warm_runs':len(warm)}
    passed=(metrics['p95_ttft']<=15 and metrics['median_output_tokens_per_second']>=2
            and metrics['p95_rewrite_seconds']<=60 and metrics['cold_first_token']<=30
            and data.get('loading_status_shown',False))
    return {'metrics':metrics,'status':'PASS (revised numerical targets on tested hardware)' if passed else 'FAIL: measured numerical thresholds not met',
            'thresholds':{'warm_ttft_p95':15.0,'median_output_tokens_per_second':2.0,'rewrite_p95_seconds':60.0,'cold_first_token_seconds':30.0},
            'benchmark_conditions':'One fixed complete 150-word paragraph repeated; default llama-cpp-python prefix reuse remains enabled. Cold means model unloaded in a fresh process; OS file cache was not cleared. Results apply to these recorded conditions.',
            'rate_method':'Actual backend decode-token count / wall time from first output to completion; includes Python callbacks and memory checks. Native decode throughput is supplementary.'}

class QualityReviewTests(unittest.TestCase):
    def test_ai_review_cannot_claim_minor_edits_above_limit(self):
        row={'output':'one two three four five six seven eight nine ten',
             'ai_review':{'usable_with_at_most_minor_edits':True,
                          'suggested_corrected_output':'zero one two three four five six seven eight nine ten eleven'}}
        self.assertFalse(ai_usable(row))

    def test_numerical_performance_requires_complete_runs_and_all_thresholds(self):
        cold={'cold_warmup':True,'ttft':30}
        warm={'measured_warm':True,'ttft':15,'seconds':60,'decode_tokens':90,'decode_tokens_per_second':2.1}
        data={'input':'word '*150,'loading_status_shown':True,'rows':[cold]+[dict(warm) for _ in range(20)]}
        self.assertTrue(numerical_performance_result(data)['status'].startswith('PASS'))
        data['rows']=data['rows'][:-1]
        self.assertTrue(numerical_performance_result(data)['status'].startswith('NOT VERIFIED'))
        data['rows'].append(dict(warm,decode_tokens=1))
        data['rows'][1:]=[dict(warm,decode_tokens=1) for _ in range(20)]
        self.assertTrue(numerical_performance_result(data)['status'].startswith('FAIL'))
    def test_equivalent_number_words_are_not_false_failures(self):
        self.assertTrue(preserves_literal_or_integer('12','Twelve records were checked.'))
        self.assertTrue(preserves_literal_or_integer('21','Twenty-one records were checked.'))
        self.assertFalse(preserves_literal_or_integer('12','Thirteen records were checked.'))
        self.assertFalse(preserves_literal_or_integer('12','112 records were checked.'))
    def test_dataset_has_30_unique_inputs_per_task(self):
        cases=quality_cases()
        self.assertEqual(len(cases),150)
        self.assertEqual(len({case['id'] for case in cases}),150)
        for task in TASKS:
            self.assertEqual(len({case['text'] for case in cases if case['task']==task}),30)

    def test_word_edit_boundary(self):
        original='one two three four five six seven eight nine ten'
        self.assertEqual(word_edits(original,original+' eleven'),(1,10))
        self.assertEqual(word_edits(original,'zero '+original+' eleven'),(2,10))
    def test_both_reviewers_must_agree_with_minor_edits(self):
        good={'meaning_preserved':True,'word_edits':1,'output_words':10}
        self.assertFalse(jointly_usable({'reviewers':{'First':good}}))
        self.assertTrue(jointly_usable({'reviewers':{'First':good,'Second':good}}))
        self.assertFalse(jointly_usable({'reviewers':{'First':good,'Second':dict(good,word_edits=2)}}))

def write_report(state):
    lines=['SPRINT 1 LOCAL AI — REQUIREMENTS, RESULTS AND SOURCE CODE',
           datetime.datetime.now().astimezone().isoformat(),
           'Scope: Tasks 1-5; Tasks 6-8 deferred. FR-03.6 removed by user.',
           'Runtime is local in-process llama-cpp-python. External editor integration is outside this component.',
           'RC target: 2GB GPU. Actual test hardware: GTX 1650 4GB with a 1.5GB AI admission budget.',
           'Automatic layer choice is largest estimated fit, not a claim of fastest configuration.',
           'CPU fallback requires available system RAM; successful runs are recorded below.',
           'Acceptance revision: NFR-04 now uses 15s/2 tok/s/60s/30s numerical targets with automatic offload; NFR-07 now permits a single explicitly labelled AI-assisted preliminary review. Original speed guarantees and two-human-review acceptance are not claimed.',
           '']
    units_ok=state.get('units',{}).get('success',False)
    for name,wording in REQUIREMENTS.items():
        if name=='FR-03.3': status='DEFERRED'
        elif name=='FR-03.6': status='REMOVED'
        elif name=='NFR-07':
            rows=state.get('quality',[])
            complete=len(rows)==150 and all('ai_review' in row for row in rows)
            accepted=all(sum(ai_usable(row) for row in rows if row['task']==task)>=24 for task in TASKS)
            status=('PASS (single AI-assisted preliminary review; not two human ratings)' if accepted else 'FAIL: fewer than 24 usable outputs for at least one task') if complete else 'NOT VERIFIED: AI-assisted review incomplete'
        elif name=='NFR-04': status=state.get('performance',{}).get('status','NOT VERIFIED: revised numerical benchmark not completed')
        elif name=='NFR-06':
            cpu_ok=state.get('cpu_smoke',{}).get('status')=='PASS on this machine'
            status='PASS (revised adaptive admission and all-task CPU execution on tested hardware; see memory-measurement limits)' if units_ok and cpu_ok else 'PARTIAL: adaptive admission checks pass; all-task CPU-only verification pending'
        elif not units_ok: status='NOT VERIFIED: unit checks have not passed'
        elif name=='FR-03.1':
            completed={row['task'] for row in state.get('quality',[]) if row['status']=='ok'}
            status='PASS (Sprint 1 task availability and real execution)' if completed==set(TASKS) else 'PARTIAL: task templates/unit checks pass; real task execution incomplete'
        else: status='PASS (local runtime component tests; see scope and evidence)'
        lines += [name+' — '+status,wording,'']
    lines += ['WHY FR-03.4 IS PASS: revised wording permits in-process local execution. The active runtime uses only local GGUF files; offline() blocks Python socket connections. Earlier server-only criteria were stricter than the supplied requirement. This is code/path evidence, not an OS firewall guarantee.',
              'WHY FR-03.7 IS PASS IF UNIT CHECKS PASS: CLI tests inject model unavailability and OOM-style failures, verify a displayed error, discarded result and unchanged source fixture. Earlier NOT PASS meant missing verification, not a demonstrated failing behavior. No claim is made for an editor not present in this repository.','',
              'UNIT RESULTS',state.get('units',{}).get('output','Not run'),
              'AUTOMATIC OFFLOAD NUMERICAL PERFORMANCE RESULTS',json.dumps(state.get('performance',{}),indent=2),
              'QUALITY AUTOMATIC CHECKS AND AI-ASSISTED PRELIMINARY RATINGS']
    lines += ['Integer preservation accepts equivalent English number words (12 = twelve). Reassessment retains initial literal-only results; model inputs/outputs are unchanged.']
    for task in TASKS:
        rows=[row for row in state.get('quality',[]) if row['task']==task]
        passed=sum(row['status']=='ok' and all(row.get('checks',{}).values()) for row in rows)
        ai_rated=sum('ai_review' in row for row in rows)
        ai_accepted=sum(ai_usable(row) for row in rows)
        lines.append(f'{task}: {len(rows)}/30 executed; {passed}/30 automatic checks passed; {ai_rated}/30 AI-reviewed; {ai_accepted}/30 usable under revised AI-assisted acceptance (minimum 24).')
    if state.get('ai_review'):
        lines += ['','SINGLE AI SEMANTIC REVIEW — NOT TWO HUMAN RATINGS',
                  json.dumps(state['ai_review'],indent=2),
                  'AI review is recorded separately from human reviewer slots. It cannot establish the original two-reviewer NFR-07.']
    if state.get('proposed_revisions'):
        lines += ['','SUPERSEDED PROPOSALS — HISTORICAL, NOT CURRENT ACCEPTANCE',
                  json.dumps(state['proposed_revisions'],indent=2)]
    if state.get('performance_history'):
        lines += ['','EARLIER PERFORMANCE ATTEMPTS (preserved; excluded from current benchmark)',
                  json.dumps(state['performance_history'],indent=2)]
    if state.get('quality_history'):
        lines += ['','EARLIER QUALITY ATTEMPTS (preserved; current results are above)',
                  json.dumps(state['quality_history'],indent=2)]
    for row in state.get('quality',[]):
        lines += ['',row['id']+' | '+row['status'],'INPUT: '+row['input'],
                  'OUTPUT: '+row.get('output',''), 'DETAILS: '+json.dumps({key:value for key,value in row.items() if key not in ('input','output')},ensure_ascii=False),
                  'OPTIONAL INDEPENDENT HUMAN REVIEWS: '+json.dumps(row.get('reviewers',{'reviewer_1':'not recorded','reviewer_2':'not recorded'}),ensure_ascii=False)]
    lines += ['','CPU-ONLY EXECUTION CHECKS (GPU model layers and operation offloading disabled)',
              json.dumps(state.get('cpu_smoke',{}),indent=2)]
    lines += ['','ENVIRONMENT AND MODEL PROVENANCE',json.dumps(state.get('environment',{}),indent=2),
              json.dumps(state.get('models',{}),indent=2)]
    archive=ROOT/'_archive'/'reports'/'offload_sweep'
    if not archive.exists(): archive=ROOT/'reports'/'offload_sweep'
    lines += ['','PREVIOUS REPEATED CPU/GPU SWEEP (short prompts, NOT NFR-04 acceptance)',
              'Three measured repeats after warmup per admitted configuration; over-budget configurations skipped.']
    for path in sorted(archive.glob('*.json')):
        data=json.loads(path.read_text(encoding='utf-8'))
        lines.append(json.dumps(data,ensure_ascii=False))
    lines += [STATE_START,json.dumps(state,ensure_ascii=False),STATE_END]
    for path in [ROOT/'local_ai.py',ROOT/'runtime'/'prompts.py',ROOT/'runtime'/'vram_policy.py',
                 ROOT/'runtime'/'ai_service.py',Path(__file__).resolve()]:
        lines += ['\nSOURCE CODE: '+str(path.relative_to(ROOT)),path.read_text(encoding='utf-8')]
    # Atomic replacement preserves the last completed case if a run is interrupted.
    temporary=REPORT.with_suffix('.tmp')
    temporary.write_text('\n'.join(lines),encoding='utf-8'); temporary.replace(REPORT)

def execute_units(state):
    output=io.StringIO()
    with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
        result=unittest.TextTestRunner(stream=output,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    state['units']={'success':result.wasSuccessful(),'tests':result.testsRun,'output':output.getvalue()}
    write_report(state)
    print(f'Unit checks: {result.testsRun}; success={result.wasSuccessful()}',flush=True)
    return result.wasSuccessful()

def record_environment(state):
    import importlib.metadata
    import platform
    from runtime.vram_policy import gpu_memory
    environment={'python':platform.python_version(),'platform':platform.platform(),
                 'cpu':platform.processor(),'gpu':gpu_memory()}
    try:
        environment['llama_cpp_python']=importlib.metadata.version('llama-cpp-python')
    except importlib.metadata.PackageNotFoundError:
        environment['llama_cpp_python']='not installed (unit checks can still run)'
    if os.name=='nt':
        import ctypes
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as key:
                environment['cpu']=winreg.QueryValueEx(key,'ProcessorNameString')[0].strip()
        except OSError:
            pass
        class MemoryStatus(ctypes.Structure):
            _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(field,ctypes.c_ulonglong) for field in
                ('total','available','page_total','page_available','virtual_total','virtual_available','extended')]
        memory=MemoryStatus(); memory.length=ctypes.sizeof(memory)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            environment.update(system_ram_total_mib=memory.total//(1024*1024),
                               system_ram_available_mib=memory.available//(1024*1024))
    state['environment']=environment
    models=state.setdefault('models',{})
    for filename in sorted({model_for(task) for task in TASKS}):
        path=ROOT/filename
        if not path.exists():
            models[filename]={'available':False}; continue
        stat=path.stat(); previous=models.get(filename,{})
        if previous.get('size')==stat.st_size and previous.get('mtime_ns')==stat.st_mtime_ns:
            continue
        with path.open('rb') as stream:
            digest=hashlib.file_digest(stream,'sha256').hexdigest()
        models[filename]={'available':True,'size':stat.st_size,'mtime_ns':stat.st_mtime_ns,'sha256':digest}

def execute_quality(rerun_task=None):
    offline(); state=load_state()
    if rerun_task:
        previous=[row for row in state.get('quality',[]) if row['task']==rerun_task]
        state.setdefault('quality_history',[]).extend(previous)
        state['quality']=[row for row in state.get('quality',[]) if row['task']!=rerun_task]
        state.pop('ai_review',None)
    completed={(row['id'],row['input']) for row in state.get('quality',[])}
    runner=Runner(max_tokens=256)
    try:
        for case in quality_cases():
            if rerun_task and case['task']!=rerun_task: continue
            if (case['id'],case['text']) in completed: continue
            replaced=[row for row in state['quality'] if row['id']==case['id']]
            if replaced:
                state.setdefault('quality_history',[]).extend(replaced)
                state['quality']=[row for row in state['quality'] if row['id']!=case['id']]
            row={'id':case['id'],'task':case['task'],'input':case['text']}
            start=time.perf_counter(); first=[]
            def emit(token):
                if token and not first: first.append(time.perf_counter())
            try:
                result=runner.run(case['task'],case['text'],emit=emit)
                row.update(output=result,checks=evaluate_case(case,result),gpu_layers=runner.actual_gpu_layers,
                           plan=runner.offload_plan.as_dict() if runner.offload_plan else None)
                row['status']='ok' if all(row['checks'].values()) else 'automatic_check_failed'
            except Exception as exc:
                row.update(status='error',error=str(exc)); runner.close()
            row['seconds']=time.perf_counter()-start
            row['first_output_seconds']=first[0]-start if first else None
            state['quality'].append(row); write_report(state)
            print(row['id'],row['status'],round(row['seconds'],2),flush=True)
    finally:
        runner.close(); write_report(state)

def execute_performance():
    """One cold/warmup run and 20 measured warm 150-word clarity rewrites."""
    state=load_state()
    if state.get('performance'):
        state.setdefault('performance_history',[]).append(state['performance'])
    offline(); runner=Runner(max_tokens=512)
    text=('The pilot study examined how university students revised academic paragraphs with a local editing tool. '
          'Twenty participants completed a writing exercise and reviewed suggestions for clarity, grammar, and academic tone. '
          'Each participant decided whether to accept or reject every suggestion, while the original document remained available for comparison. '
          'Researchers recorded completion times and collected brief comments about the usefulness of the proposed changes. '
          'Several participants reported that shorter sentences made their arguments easier to follow, although the study did not measure reader comprehension directly. '
          'The sample came from one course, participation was voluntary, and no comparison group was included. '
          'Consequently, the findings should be interpreted as preliminary observations rather than evidence that the tool caused better writing. '
          'Future evaluations should include larger samples, independent reviewers, and repeated tasks before conclusions are drawn about effectiveness across different disciplines or levels of writing experience. '
          'These limitations must remain explicit in subsequent reports.')
    assert len(text.split())==150
    rows=[]; state['performance']={'status':'RUNNING: latest numerical NFR-04','rows':rows,'input':text,
        'input_words':150,'thresholds':{'warm_ttft_p95':15.0,'median_decode_tokens_per_second':2.0,
                                     'rewrite_p95_seconds':60.0,'cold_first_token_seconds':30.0},
        'test_hardware_note':'Actual GPU is GTX 1650 4GB; AI budget remains 1.5GB. No physical 2GB-card speed claim.'}
    try:
        for index in range(21):
            start=time.perf_counter(); first=[]
            status=io.StringIO()
            with contextlib.redirect_stderr(status):
                runner.load('clarity')
            if index==0:
                state['performance']['loading_status_shown']='Loading local model' in status.getvalue()
                print(status.getvalue(),file=sys.stderr,flush=True)
            import llama_cpp
            llama_cpp.llama_perf_context_reset(runner.model._ctx.ctx)
            def emit(token):
                if token and not first: first.append(time.perf_counter())
            output=runner.run('clarity',text,emit=emit)
            perf=llama_cpp.llama_perf_context(runner.model._ctx.ctx)
            if not first or perf.n_eval<=0 or perf.t_eval_ms<=0:
                raise RuntimeError('Missing first token or backend decode-token timing')
            rows.append({'run':index,'cold_warmup':index==0,'measured_warm':index>0,
                         'seconds':time.perf_counter()-start,'ttft':first[0]-start,
                         'gpu_layers':runner.actual_gpu_layers,
                         'plan':runner.offload_plan.as_dict() if runner.offload_plan else None,
                         'decode_tokens':perf.n_eval,'decode_seconds':perf.t_eval_ms/1000,
                         'decode_tokens_per_second':perf.n_eval/(perf.t_eval_ms/1000),'output':output})
            write_report(state)
            print('Performance',index,'seconds',round(rows[-1]['seconds'],2),
                  'decode tok/s',round(rows[-1]['decode_tokens_per_second'],2),flush=True)
        state['performance'].update(numerical_performance_result(state['performance']))
    except Exception as exc:
        state['performance'].update(status='NOT VERIFIED: numerical benchmark interrupted',error=str(exc))
    finally:
        runner.close(); write_report(state)


def execute_cpu_smoke():
    offline(); state=load_state(); rows=[]; runner=Runner(gpu_layers=0,max_tokens=256)
    try:
        for task in TASKS:
            case=next(case for case in quality_cases() if case['task']==task)
            start=time.perf_counter(); row={'task':task,'input':case['text']}
            try:
                output=runner.run(task,case['text'])
                row.update(status='ok',gpu_layers=runner.actual_gpu_layers,op_offload=False,
                           output=output,checks=evaluate_case(case,output))
            except Exception as exc:
                row.update(status='error',error=str(exc)); runner.close()
            row['seconds']=time.perf_counter()-start; rows.append(row)
            state['cpu_smoke']={'rows':rows,'status':'PASS on this machine' if len(rows)==5 and all(row['status']=='ok' and row['gpu_layers']==0 for row in rows) else 'RUNNING or incomplete'}
            write_report(state); print('CPU',task,row['status'],round(row['seconds'],2),flush=True)
    finally:
        runner.close(); write_report(state)

def record_reviews(name):
    state=load_state(); rows=state.get('quality',[])
    if len(rows)!=150:
        raise ValueError('Finish the 150-prompt test run before recording human reviews.')
    names={reviewer for row in rows for reviewer in row.get('reviewers',{})}
    if name not in names and len(names)>=2:
        raise ValueError('Two reviewer identities already exist. Use the same name to resume your review.')
    for row in rows:
        if name in row.get('reviewers',{}): continue
        print('\n'+row['id']+'\nINPUT: '+row['input']+'\nOUTPUT: '+row.get('output',''))
        print('Review independently. Enter q to save and stop.')
        answer=input('Is the meaning correct/preserved? [y/n/q] ').strip().lower()
        if answer=='q': break
        if answer not in ('y','n'):
            print('Please rerun and answer y or n.'); break
        corrected=row.get('output','')
        if answer=='y':
            print('Enter corrected output, ending with .end; an immediate .end accepts unchanged output.')
            text=[]
            while True:
                line=input()
                if line=='.end': break
                text.append(line)
            if text: corrected='\n'.join(text)
        edits,words=word_edits(row.get('output',''),corrected)
        row.setdefault('reviewers',{})[name]={'meaning_preserved':answer=='y','word_edits':edits,
            'output_words':words,'corrected_output':corrected,'timestamp':datetime.datetime.now().astimezone().isoformat()}
        write_report(state)
    print('Review saved to',REPORT)

def reassess_saved_checks():
    state=load_state(); cases={case['id']:case for case in quality_cases()}
    for row in state.get('quality',[]):
        if 'output' not in row: continue
        checks=evaluate_case(cases[row['id']],row['output'])
        if checks != row['checks']:
            row.setdefault('initial_checks',row['checks'])
            row.setdefault('initial_status',row['status'])
            row['checks_reassessed_reason']='Equivalent integer words accepted; changed numeric values still fail.'
            row['checks']=checks
            row['status']='ok' if all(checks.values()) else 'automatic_check_failed'
    write_report(state)
    print('Saved automatic checks reassessed; original results retained.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all',action='store_true',help='Unit tests + numerical 20-run benchmark + 150 prompts + CPU checks')
    parser.add_argument('--quality-worker',action='store_true',help=argparse.SUPPRESS)
    parser.add_argument('--rerun-task',choices=list(TASKS),help='Regenerate 30 cases of one task, retaining previous attempts')
    parser.add_argument('--performance-worker',action='store_true',help=argparse.SUPPRESS)
    parser.add_argument('--cpu-worker',action='store_true',help=argparse.SUPPRESS)
    parser.add_argument('--reviewer',help='Record an independent human review by this reviewer name; resumes saved ratings')
    parser.add_argument('--recheck',action='store_true',help='Reassess saved outputs with current checks; retain original check results')
    parser.add_argument('--report-only',action='store_true')
    args=parser.parse_args()
    if args.recheck: reassess_saved_checks(); return
    if args.reviewer: record_reviews(args.reviewer); return
    if args.quality_worker: execute_quality(args.rerun_task); return
    if args.performance_worker: execute_performance(); return
    if args.cpu_worker: execute_cpu_smoke(); return
    state=load_state()
    if args.report_only:
        if state.get('performance',{}).get('rows'):
            state['performance'].update(numerical_performance_result(state['performance']))
        write_report(state); return
    record_environment(state)
    passed=execute_units(state)
    if args.all and passed:
        for mode in ('--performance-worker','--quality-worker','--cpu-worker','--recheck'):
            result=subprocess.run([sys.executable,str(Path(__file__).resolve()),mode],cwd=ROOT)
            if result.returncode: raise SystemExit(result.returncode)
    print(REPORT)
    print('Exit status reflects unit checks/execution only; individual FR/NFR acceptance is in the report.')
    raise SystemExit(0 if passed else 1)

if __name__=='__main__': main()
