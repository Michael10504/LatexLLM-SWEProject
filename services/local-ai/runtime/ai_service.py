"""Selection-only service and strict loopback OpenAI-compatible streaming adapter."""
import http.client
import json
import threading
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Iterator
from local_ai import validate
from .prompts import PROMPTS

ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions'
TokenStream = Iterator[str]

class ModelAdapter(Protocol):
    def generate(self, messages: list) -> TokenStream: ...
    def abort(self) -> None: ...
    def isAvailable(self) -> bool: ...

class ModelRegistry:
    def __init__(self, path=Path(__file__).with_name('models.json')):
        self.models = json.loads(Path(path).read_text(encoding='utf-8'))
        for model in self.models.values():
            if not 1 <= model['context'] <= 4096:
                raise ValueError('Invalid model context')

    def get(self, model_id):
        return self.models[model_id]

class PromptBuilder:
    @staticmethod
    def build(task, selection):
        validate(task, selection)
        return [{'role': 'system', 'content': PROMPTS[task]},
                {'role': 'user', 'content': selection + '\n/no_think'}]

class AccessControl:
    @staticmethod
    def require_edit(role):
        if role not in ('OWNER', 'EDITOR'):
            raise PermissionError('Only editors and owners can run AI tasks.')

@dataclass(frozen=True)
class SelectionTask:
    task: str
    selection: str

class StubModelAdapter:
    def __init__(self, recording=None):
        self.recording = recording or ['Recorded ', 'response.']
        self.cancelled = threading.Event()
    def isAvailable(self):
        return True
    def abort(self):
        self.cancelled.set()
    def generate(self, messages):
        self.cancelled.clear()
        for token in self.recording:
            if self.cancelled.is_set():
                raise InterruptedError('Cancelled')
            yield token

class LlamaCppAdapter:
    def __init__(self, endpoint=ENDPOINT, timeout=15):
        if endpoint != ENDPOINT:
            raise ValueError('Only the fixed IPv4 loopback endpoint is allowed.')
        self.timeout = timeout
        self.cancelled = threading.Event()
        self.connection = None
    def isAvailable(self):
        connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=2)
        try:
            connection.request('GET', '/health')
            return connection.getresponse().status == 200
        except OSError:
            return False
        finally:
            connection.close()
    def abort(self):
        self.cancelled.set()
        if self.connection:
            if self.connection.sock:
                try:
                    self.connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            self.connection.close()
    def generate(self, messages):
        self.cancelled.clear()
        connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=self.timeout)
        self.connection = connection
        try:
            connection.request('POST', '/v1/chat/completions',
                json.dumps({'messages': messages, 'stream': True, 'max_tokens': 512,
                            'temperature': 0, 'cache_prompt': False}),
                {'Content-Type': 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeError(f'Local model failed (HTTP {response.status}).')
            while True:
                if self.cancelled.is_set():
                    raise InterruptedError('Cancelled')
                line = response.readline()
                if not line:
                    raise RuntimeError('Local model disconnected before completion.')
                if not line.startswith(b'data: '):
                    continue
                payload = line[6:].strip()
                if payload == b'[DONE]':
                    return
                packet = json.loads(payload)
                if packet.get('error'):
                    raise RuntimeError('Local model reported an error.')
                choice = packet['choices'][0]
                if choice.get('finish_reason') == 'length':
                    raise RuntimeError('Output truncated; result discarded.')
                token = choice.get('delta', {}).get('content', '')
                if token:
                    yield token
        except (OSError, ValueError, KeyError) as exc:
            if self.cancelled.is_set():
                raise InterruptedError('Cancelled') from exc
            raise RuntimeError('Local model unavailable or stream invalid; retry.') from exc
        finally:
            connection.close()
            self.connection = None

class AITaskService:
    """Returns a proposal only; owns no document and never applies edits."""
    def __init__(self, adapter):
        self.adapter = adapter
        self.preview = ''
        self.cancelled = threading.Event()
        self.lock = threading.Lock()
    def cancel(self):
        self.cancelled.set()
        self.preview = ''
        self.adapter.abort()
    def run(self, request, role, emit=lambda token: None, status=lambda value: None):
        AccessControl.require_edit(role)
        messages = PromptBuilder.build(request.task, request.selection)
        self.cancelled.clear()
        self.preview = ''
        try:
            status('loading')
            if not self.adapter.isAvailable():
                raise RuntimeError('Local model unavailable. Start the local runtime.')
            status('generating')
            for token in self.adapter.generate(messages):
                if self.cancelled.is_set():
                    raise InterruptedError('Cancelled')
                self.preview += token
                emit(token)
            if self.cancelled.is_set():
                raise InterruptedError('Cancelled')
            if not self.preview.strip():
                raise RuntimeError('Local model returned no text.')
            return self.preview
        finally:
            self.preview = ''
            status('idle')
