"""Private JSON-lines IPC worker. No HTTP listener, file writes, or cloud fallback.

The Electron main process owns stdin/stdout and terminates this process to cancel
native inference. One Runner is reused until cancellation or shutdown.
"""
import argparse
import json
import sys
import time
from local_ai import Runner, TASKS, offline, validate, model_for


def send(identifier, event, **fields):
    print(json.dumps({'id': identifier, 'event': event, **fields}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stub', action='store_true', help='Explicit development-only recorded response')
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8', write_through=True)
    offline()
    runner = Runner()
    try:
        for line in sys.stdin:
            identifier = None
            try:
                if len(line) > 131072:
                    raise ValueError('AI request exceeds the transport limit.')
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError('Invalid AI request.')
                identifier = request.get('id')
                if not isinstance(identifier, str) or not 1 <= len(identifier) <= 100:
                    raise ValueError('Invalid request identifier.')
                if request.get('role') not in ('OWNER', 'EDITOR'):
                    raise PermissionError('Viewers cannot run local AI tasks.')
                task, text = request.get('task'), request.get('text')
                validate(task, text)
                began = time.monotonic()
                send(identifier, 'status', status='loading' if runner.model is None else 'preparing')
                if args.stub:
                    result = f'[DEMO STUB: {task}; not model output]\n{text}'
                    send(identifier, 'status', status='generating')
                    for index in range(0, len(result), 12):
                        time.sleep(.04)
                        send(identifier, 'token', text=result[index:index+12])
                else:
                    started = False
                    def emit(token):
                        nonlocal started
                        if not started:
                            send(identifier, 'status', status='generating')
                            started = True
                            plan = runner.offload_plan
                            mode = f'{runner.actual_gpu_layers}/{plan.total_layers} GPU layers' if plan and runner.actual_gpu_layers else 'CPU execution'
                            reason = plan.reason if plan else 'No GPU plan available'
                            send(identifier, 'status', status=f'Runtime: {model_for(task)}; {mode}; first text {time.monotonic()-began:.1f}s. {reason}')
                        send(identifier, 'token', text=token)
                    result = runner.run(task, text, emit=emit)
                send(identifier, 'result', text=result, stub=args.stub)
            except (Exception, KeyboardInterrupt) as exc:
                runner.close()
                send(identifier, 'error', message=str(exc) or 'Local inference failed. Result discarded.')
    finally:
        runner.close()


if __name__ == '__main__':
    main()
