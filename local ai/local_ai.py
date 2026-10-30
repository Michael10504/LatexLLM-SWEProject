"""Offline terminal inference for the first five academic editing tasks."""
import argparse
import gc
import json
import os
from pathlib import Path
import re
import socket
import sys
from prompts import PROMPTS, schema_for

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
    return OUTLINE_MODEL if task == 'outline' else STRONG_MODEL

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


def grammar_parts(text):
    """Conservative English boundaries; preserve separators and protected LaTeX.

    This is a heuristic, not a general multilingual sentence parser. Known
    abbreviations, initials, decimals and protected spans remain together.
    """
    masked, spans = protect(text)
    parts = []
    start = 0
    abbreviations = {'dr', 'mr', 'mrs', 'ms', 'prof', 'fig', 'figs',
                     'eq', 'eqs', 'sec', 'secs', 'ref', 'refs', 'no',
                     'vol', 'vs', 'etc', 'al', 'e.g', 'i.e'}
    for match in re.finditer(r'(?<=[.!?])(?:[ \t]+|[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*)', masked):
        before = masked[start:match.start()]
        if before.endswith('.'):
            word = re.search(r'([A-Za-z.]+)\.$', before)
            if word and (word.group(1).lower() in abbreviations
                         or re.fullmatch(r'(?:[A-Za-z]\.)*[A-Za-z]', word.group(1))):
                continue
            # A numbered list marker is not a sentence.
            if re.fullmatch(r'\s*\d+\.', before):
                continue
        parts.extend((masked[start:match.start()], match.group()))
        start = match.end()
    parts.append(masked[start:])
    restored = []
    for part in parts:
        restored.append(re.sub(r'PROTECTEDSPAN(\d{4,})END',
                               lambda m: spans[int(m.group(1))], part))
    return restored


class GrammarPreview:
    """Restore protection tokens even when split across model chunks.

    Preview remains provisional; callers must discard it if run() raises.
    """
    def __init__(self, text, emit):
        _, self.spans = protect(text)
        self.emit = emit
        self.pending = ''

    def feed(self, part):
        self.pending += part
        marker = 'PROTECTEDSPAN'
        while self.pending:
            if self.pending.startswith(marker):
                match = re.match(r'PROTECTEDSPAN(\d{4,})END', self.pending)
                if not match:
                    return
                index = int(match.group(1))
                if index >= len(self.spans):
                    raise ValueError('Model invented protected LaTeX; result discarded.')
                self.emit(self.spans[index])
                self.pending = self.pending[match.end():]
            else:
                # Hold any suffix that might begin a token in the next chunk.
                offset = self.pending.find(marker)
                if offset >= 0:
                    self.emit(self.pending[:offset])
                    self.pending = self.pending[offset:]
                    continue
                hold = 0
                for size in range(1, min(len(marker), len(self.pending)) + 1):
                    if self.pending.endswith(marker[:size]):
                        hold = size
                ready = self.pending[:-hold] if hold else self.pending
                if ready:
                    self.emit(ready)
                self.pending = self.pending[-hold:] if hold else ''
                return

    def finish(self):
        if self.pending:
            if self.pending.startswith('PROTECTEDSPAN'):
                raise ValueError('Model changed protected LaTeX; result discarded.')
            self.emit(self.pending)
            self.pending = ''


class Runner:
    def __init__(self, context=4096, max_tokens=1024, gpu_layers=None):
        self.context, self.max_tokens, self.gpu_layers = context, max_tokens, gpu_layers
        self.loaded_key = None
        self.actual_gpu_layers = 0
        self.model = None
        self.task = None

    def close(self):
        if self.model is not None:
            if hasattr(self.model, 'close'):
                self.model.close()
            self.model = None
        self.task = None
        self.loaded_key = None
        self.actual_gpu_layers = 0
        gc.collect()

    def load(self, task):
        path = ROOT / model_for(task)
        if task == 'outline' and self.gpu_layers == 0:
            raise RuntimeError('Outline requires GPU offloading. Use a nonzero --gpu-layers value.')
        if self.model is not None and self.loaded_key == str(path):
            if task == 'outline' and self.actual_gpu_layers == 0:
                raise RuntimeError('Outline requires GPU offloading. Restart with nonzero --gpu-layers and a GPU backend.')
            self.task = task
            return
        self.close()
        if not path.is_file():
            hint = 'Restore your outline GGUF.' if task == 'outline' else 'Run download_strong_model.py during setup.'
            raise FileNotFoundError(f'Model unavailable: {path}. {hint}')
        settings_path = ROOT / 'gpu_settings.json'
        if settings_path.is_file():
            settings = json.loads(settings_path.read_text(encoding='utf-8'))
            if 'vulkan_visible_devices' in settings:
                os.environ.setdefault('GGML_VK_VISIBLE_DEVICES', str(settings['vulkan_visible_devices']))
        from llama_cpp import Llama, llama_supports_gpu_offload
        layers = 12 if self.gpu_layers is None else self.gpu_layers
        supported = llama_supports_gpu_offload()
        if task == 'outline' and (layers == 0 or not supported):
            raise RuntimeError('Outline requires GPU offloading. Use a Vulkan/CUDA backend and nonzero --gpu-layers.')
        if layers and not supported:
            print('GPU backend unavailable; using CPU. Install a Vulkan or CUDA wheel for offloading.', file=sys.stderr)
            layers = 0
        self.model = Llama(model_path=str(path), n_ctx=self.context, n_batch=128,
                           n_gpu_layers=layers, offload_kqv=False, verbose=False)
        self.actual_gpu_layers = layers
        self.task, self.loaded_key = task, str(path)
        print(f'Loaded {path.name}: {layers} GPU layers requested; remaining layers on CPU.', file=sys.stderr)

    def run(self, task, text, emit=lambda chunk: None, notes=None):
        if task != 'grammar' or notes is not None:
            return self._run_single(task, text, emit, notes)
        # Enforce the selection limit before loading or splitting the input.
        validate(task, text)
        parts = grammar_parts(text)
        results = []
        for index, part in enumerate(parts):
            if index % 2 or not part.strip():
                results.append(part)
                emit(part)
                continue
            leading = part[:len(part) - len(part.lstrip())]
            trailing = part[len(part.rstrip()):]
            source = part.strip()
            if leading:
                emit(leading)
            preview = GrammarPreview(source, emit)
            result = self._run_single(task, source, preview.feed)
            preview.finish()
            if trailing:
                emit(trailing)
            results.append(leading + result.strip() + trailing)
        return ''.join(results)

    def _run_single(self, task, text, emit=lambda chunk: None, notes=None):
        validate(task, text)
        if notes is not None:
            if task != 'notes' or not isinstance(notes, list) or not notes or any(
                not isinstance(n, dict) or not isinstance(n.get('text'), str) or not n['text'].strip() for n in notes
            ):
                raise ValueError('Notes must contain nonempty text strings for task 1.')
            validate(task, '\n'.join(n['text'] for n in notes))
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
        elif task == 'grammar':
            demonstration = (
                '<|im_start|>user\n'
                'The coefficient PROTECTEDSPAN0000END control the response. '
                'Its units is specified in PROTECTEDSPAN0001END.'
                '<|im_end|>\n'
                '<|im_start|>assistant\n'
                'The coefficient PROTECTEDSPAN0000END controls the response. '
                'Its units are specified in PROTECTEDSPAN0001END.'
                '<|im_end|>\n'
                '<|im_start|>user\n'
                'Both operators was present. The instrument did not detects '
                'a change, and the readings remains uncertain.'
                '<|im_end|>\n'
                '<|im_start|>assistant\n'
                'Both operators were present. The instrument did not detect '
                'a change, and the readings remain uncertain.'
                '<|im_end|>\n'
                '<|im_start|>user\n'
                'The device have a display. Its purpose are described '
                'in PROTECTEDSPAN0000END.'
                '<|im_end|>\n'
                '<|im_start|>assistant\n'
                'The device has a display. Its purpose is described '
                'in PROTECTEDSPAN0000END.'
                '<|im_end|>\n'
            )
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
    p.add_argument('--gpu-layers', type=int, default=None, help='GPU offload layers (default: 12); outline requires nonzero offloading')
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
