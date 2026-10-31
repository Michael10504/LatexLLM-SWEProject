"""Offline terminal inference for five academic editing tasks with automatic offloading."""
import argparse
import gc
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
from runtime.prompts import PROMPTS, schema_for

ROOT = Path(__file__).resolve().parent
TASKS = {
    'notes': 'Extract and organize notes from context',
    'outline': 'Write a section outline',
    'clarity': 'Rewrite for clarity',
    'tone': 'Adjust academic tone',
    'grammar': 'Check grammar'
}
STRONG_MODEL = 'Qwen3-4B-Q4_K_M.gguf'
OUTLINE_MODEL = 'outline-q4_k_m.gguf'
MENU = {str(i): task for i, task in enumerate(TASKS, 1)}

def model_for(task):
    if task == 'outline':
        # The private fine-tuned specialist is optional on fresh installations.
        # The public model can execute the same outline prompt entirely locally.
        return STRONG_MODEL if not (ROOT / OUTLINE_MODEL).is_file() and (ROOT / STRONG_MODEL).is_file() else OUTLINE_MODEL
    return STRONG_MODEL

def check_academic_voice(text):
    # Quoted source language and protected math/citations are not the author's voice.
    prose = re.sub(r'"[^"\n]*"|“[^”\n]*”', '', text)
    if re.search(r'\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Uu]s|[Oo]ur|[Oo]urs|[Oo]urselves)\b', prose):
        raise ValueError('Academic tone retained first-person wording; result discarded. Try a smaller selection.')

def offline():
    for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY', 'DO_NOT_TRACK'):
        os.environ[key] = '1'
    def denied(*args, **kwargs):
        raise OSError('Network access is disabled for local AI inference.')
    socket.socket.connect = denied
    socket.socket.connect_ex = denied
    socket.create_connection = denied

def validate(task, text):
    if task not in TASKS:
       raise ValueError('Only tasks 1-5 are implemented in this release.')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Please select text before running this task.')
    if len(text.split()) > 1000:
        raise ValueError('Selection exceeds 1,000 words. Please select a smaller selection.')

PROTECTED = re.compile(r'\\begin\{(\w+\*?)\}.*?\\end\{\1\}|\$\$.*?\$\$|\$[^$\n]+\$|\\\[.*?\\\]|\\\(.*?\\\)|\\(?:cite\w*|ref|eqref|label)\*?(?:\[[^\]]*\])*\{[^}]*\}', re.S)

def protect(text):
    spans = []
    def replace(match):
        token = f'PROTECTEDSPAN{len(spans):04d}END'
        if token in text:
            raise ValueError('Input contains a reserved protection token.')
        spans.append(match.group())
        return token
    return PROTECTED.sub(replace, text), spans

class Runner:
    def __init__(self, context=4096, max_tokens=1024, gpu_layers=None):
        if not 1 <= context <= 4096 or not 1 <= max_tokens < context:
            raise ValueError('Context must be <=4096 and output tokens must fit inside it.')
        self.context, self.max_tokens, self.gpu_layers = context, max_tokens, gpu_layers
        self.loaded_key = None
        self.actual_gpu_layers = 0
        self.model = None
        self.task = None
        self.offload_plan = None
        self._memory_checked = 0

    def close(self):
        if self.model is not None:
            if hasattr(self.model, 'close'):
                self.model.close()
            self.model = None
        self.task = None
        self.loaded_key = None
        self.actual_gpu_layers = 0
        self.offload_plan = None
        gc.collect()

    def _gpu_memory_ok(self):
        if not self.actual_gpu_layers or self.offload_plan is None:
            return True
        from runtime.vram_policy import gpu_memory, CAP_MIB, RESERVE_MIB
        memory = gpu_memory(self.offload_plan.uuid)
        return (memory is not None and memory['free_mib'] >= RESERVE_MIB
                and memory['used_mib']-self.offload_plan.baseline_used_mib <= CAP_MIB)

    def load(self, task):
        path = ROOT / model_for(task)
        if self.model is not None and self.loaded_key == str(path):
            if self._gpu_memory_ok():
                self.task = task
                return
            self.close()
        self.close()
        if not path.is_file():
            hint = 'Restore your outline GGUF.' if task == 'outline' else 'Run download_strong_model.py during setup.'
            raise FileNotFoundError(f'Model unavailable: {path}. {hint}')
        settings = {}
        settings_path = ROOT / 'gpu_settings.json'
        if settings_path.is_file():
            settings = json.loads(settings_path.read_text(encoding='utf-8'))
            if 'vulkan_visible_devices' in settings:
                os.environ.setdefault('GGML_VK_VISIBLE_DEVICES', str(settings['vulkan_visible_devices']))
        from llama_cpp import Llama, llama_supports_gpu_offload
        print('Loading local model; preparing CPU/GPU execution...', file=sys.stderr, flush=True)
        supported = llama_supports_gpu_offload()
        from runtime.vram_policy import choose_offload
        plan = choose_offload(path, self.gpu_layers, settings, supported)
        layers = plan.gpu_layers
        print(f'VRAM plan: {layers}/{plan.total_layers} GPU layers; '
              f'free VRAM {plan.free_vram_mib}/{plan.total_vram_mib} MiB; '
              f'estimated {plan.estimated_mib} MiB / available budget {plan.available_budget_mib} MiB. '
              f'{plan.reason}.', file=sys.stderr)
        try:
            self.model = Llama(model_path=str(path), n_ctx=self.context, n_batch=128,
                               n_gpu_layers=layers, offload_kqv=False, op_offload=bool(layers), verbose=False)
        except Exception:
            if not layers:
                raise
            gc.collect()
            print('GPU load failed; retrying entirely on CPU.', file=sys.stderr)
            layers = 0
            plan.gpu_layers = 0
            plan.estimated_mib = 0
            plan.reason = 'GPU load failed; CPU fallback'
            self.model = Llama(model_path=str(path), n_ctx=self.context, n_batch=128,
                               n_gpu_layers=0, offload_kqv=False, op_offload=False, verbose=False)
        self.actual_gpu_layers = layers
        self.offload_plan = plan
        if not self._gpu_memory_ok():
            self.close()
            print('GPU memory changed or exceeded budget during loading; using CPU.', file=sys.stderr)
            self.model = Llama(model_path=str(path), n_ctx=self.context, n_batch=128,
                               n_gpu_layers=0, offload_kqv=False, op_offload=False, verbose=False)
            layers = 0
            plan.gpu_layers = 0
            plan.estimated_mib = 0
            plan.reason = 'Memory changed during loading; CPU fallback'
            self.offload_plan = plan
        self.task, self.loaded_key = task, str(path)
        print(f'Loaded {path.name}: {layers} GPU layers requested; remaining layers on CPU.', file=sys.stderr)

    def run(self, task, text, emit=lambda chunk: None, notes=None):
        validate(task, text)
        if notes is not None:
            if task != 'notes' or not isinstance(notes, list) or not notes or any(
                not isinstance(n, dict) or not isinstance(n.get('text'), str) or not n['text'].strip() for n in notes
            ):
                raise ValueError('Notes must contain nonempty text strings for task 1.')
            validate(task, '\n'.join(n['text'] for n in notes))
            if '\n'.join(n['text'] for n in notes) != text:
                raise ValueError('Notes must match the selected text; only the current selection is allowed.')
        if notes is not None:
            text = '\n'.join(n['text'] for n in notes)
        self.load(task)
        masked, spans = protect(text) if task in ('clarity', 'tone', 'grammar') else (text, [])
        user = masked + '\n/no_think'
        # Explicit Qwen3 ChatML template; suppress hidden reasoning at generation start.
        system = PROMPTS[task]
        demonstration = ''
        if task == 'tone':
            demonstration = ('<|im_start|>user\nI tested the method on 20 samples, but I am not sure it works in other settings.<|im_end|>\n'
                             '<|im_start|>assistant\nThe method was tested on 20 samples, but its performance in other settings remains uncertain.<|im_end|>\n')
        elif task == 'notes':
            demonstration = ('<|im_start|>user\nA campus pilot included 8 participants. Findings were preliminary; causality was not established.<|im_end|>\n'
                             '<|im_start|>assistant\n{"groups":[{"heading":"Campus pilot","notes":["The campus pilot included 8 participants.","Findings were preliminary; causality was not established."]}]}<|im_end|>\n')
        prompt = f'<|im_start|>system\n{system}<|im_end|>\n{demonstration}<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
        if len(self.model.tokenize(prompt.encode('utf-8'))) + self.max_tokens > self.context:
            raise ValueError('Selection exceeds model token capacity. Please select a smaller selection.')
        options = {}
        if task in ('notes', 'outline'):
            from llama_cpp import LlamaGrammar
            options['grammar'] = LlamaGrammar.from_json_schema(json.dumps(schema_for(task)), verbose=False)
        output = ''
        for chunk in self.model(prompt, max_tokens=self.max_tokens, temperature=0,
                                stream=True, stop=['<|im_end|>', '<|im_start|>'], **options):
            if self.actual_gpu_layers and time.monotonic()-self._memory_checked >= 2:
                self._memory_checked = time.monotonic()
                if not self._gpu_memory_ok():
                    raise RuntimeError('GPU memory unavailable or budget exceeded; partial result discarded. Retry on CPU.')
            choice = chunk['choices'][0]
            if choice.get('finish_reason') == 'length':
                raise ValueError('Output token limit reached; result discarded. Use a smaller selection.')
            part = choice.get('text', '')
            output += part
            emit(part)
        if not output.strip():
            raise ValueError('Model returned no text.')
        if task == 'tone':
            check_academic_voice(output)
        for i, span in enumerate(spans):
            token = f'PROTECTEDSPAN{i:04d}END'
            if output.count(token) != 1:
                raise ValueError('Model changed protected LaTeX; result discarded.')
            output = output.replace(token, span)
        if task in ('notes', 'outline'):
            clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', output.strip())
            obj = json.loads(clean)
            key, field = ('groups', 'notes') if task == 'notes' else ('sections', 'subsections')
            if not isinstance(obj, dict) or set(obj) != {key} or not isinstance(obj[key], list) or not obj[key]:
                raise ValueError(f'Invalid {task} structure.')
            for section in obj[key]:
                if (not isinstance(section, dict) or set(section) != {'heading', field}
                    or not isinstance(section['heading'], str) or not section['heading'].strip()
                    or not isinstance(section[field], list) or not section[field]
                    or not all(isinstance(x, str) and x.strip() for x in section[field])):
                    raise ValueError(f'Invalid {task} entry.')
            output = json.dumps(obj, ensure_ascii=False, indent=2)
        return output

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--context', type=int, default=4096)
    p.add_argument('--max-tokens', type=int, default=1024)
    p.add_argument('--gpu-layers', type=int, default=None,
                   help='Default: auto-fit free VRAM under 1.5 GB. 0: CPU; -1: full if it fits; N: maximum GPU layers.')
    a = p.parse_args()
    offline()
    runner = Runner(a.context, a.max_tokens, a.gpu_layers)
    try:
        while True:
            print('\nLocal AI - tasks 1-5')
            for i, task in MENU.items():
                label = 'fine-tuned Qwen3-1.7B' if task == 'outline' else 'shared Qwen3-4B'
                print(f'{i}. {TASKS[task]} [{label}]')
            choice = input('Choose option (1-5), or q to quit: ').strip()
            if choice.lower() == 'q':
                break
            if choice not in MENU:
                print('Choose 1, 2, 3, 4 or 5.')
                continue
            task = MENU[choice]
            print('Paste selected text; finish with a line containing only .end')
            if task == 'notes':
                print('Paste continuous context. Key notes will be extracted and organized by theme.')
            lines = []
            while True:
                line = input()
                if line == '.end':
                    break
                lines.append(line)
            print('Running locally. [Cancel: Ctrl+C] Streaming preview (uncommitted):', flush=True)
            try:
                result = runner.run(task, '\n'.join(lines), lambda s: print(s, end='', flush=True))
                print('\n\nValidated result:\n' + result)
            except KeyboardInterrupt:
                runner.close()
                print('\033[2J\033[HCancelled. Partial result discarded; document unchanged.')
            except Exception as exc:
                runner.close()
                print(f'\033[2J\033[HError: {exc}\nResult discarded; document unchanged.')
    except (EOFError, KeyboardInterrupt):
        print('\nExiting.')
    finally:
        runner.close()

if __name__ == '__main__':
    main()
