namespace WS5 {
    export const tasks = [
        ['notes', 'Organize notes'], ['outline', 'Write a section outline'],
        ['clarity', 'Rewrite for clarity'], ['tone', 'Adjust academic tone'],
        ['grammar', 'Check grammar'], ['table', 'Insert a table'],
        ['caption', 'Write a figure caption'], ['latex', 'Fix LaTeX syntax']
    ] as const;
    export type Task = typeof tasks[number][0];
    export type Status = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed';
    export interface Request { task: Task; text: string; }
    export interface Input { selection: string; compileLog: string; }
    export interface Engine {
        run(request: Request, signal: AbortSignal, emit: (chunk: string) => void): Promise<string>;
    }
    export interface State { status: Status; original: string; output: string; message: string; }

    // No editor-write capability is supplied to this controller.
    export class Controller {
        private state: State = { status: 'idle', original: '', output: '', message: 'Ready.' };
        private active?: AbortController;
        private version = 0;
        constructor(private engine: Engine, private changed: (state: State) => void) {}
        snapshot(): State { return { ...this.state }; }
        private publish(): void { this.changed(this.snapshot()); }
        cancel(): void {
            if (this.state.status !== 'running') return;
            ++this.version;
            this.active?.abort();
            this.active = undefined;
            this.state = { ...this.state, status: 'cancelled', output: '', message: 'Cancelled. Partial output discarded. Document unchanged.' };
            this.publish();
        }
        async run(task: Task, input: Input): Promise<void> {
            if (this.state.status === 'running') return;
            let error = '';
            const text = task === 'latex' ? input.compileLog : input.selection;
            if (!tasks.some(([id]) => id === task)) error = 'Choose a valid task.';
            else if (!text.trim()) error = task === 'latex' ? 'Compile first: no compile log is available.' : 'Please select text first.';
            else if (task !== 'latex' && text.trim().split(/\s+/u).length > 1000) error = 'Please select no more than 1,000 words.';
            if (error) {
                this.state = { status: 'failed', original: text, output: '', message: error };
                this.publish();
                return;
            }
            const version = ++this.version;
            const abort = new AbortController();
            this.active = abort;
            this.state = { status: 'running', original: text, output: '', message: 'Running. Preview only; document unchanged.' };
            this.publish();
            try {
                const result = await this.engine.run({ task, text }, abort.signal, chunk => {
                    if (version !== this.version || abort.signal.aborted) return;
                    this.state.output += chunk;
                    this.publish();
                });
                if (version !== this.version || abort.signal.aborted) return;
                if (!result.trim()) throw new Error('No output was returned.');
                this.state = { ...this.state, status: 'completed', output: result, message: 'Completed. Read-only suggestion; document unchanged.' };
            } catch (error) {
                if (version !== this.version || abort.signal.aborted) return;
                this.state = { ...this.state, status: 'failed', output: '', message: error instanceof Error ? error.message : 'AI request failed.' };
            } finally {
                if (version === this.version) { this.active = undefined; this.publish(); }
            }
        }
    }

    // Deliberately fake: this tests UI behavior, not AI output quality or NFR speed.
    export class StubEngine implements Engine {
        constructor(private fail = false) {}
        async run(request: Request, signal: AbortSignal, emit: (chunk: string) => void): Promise<string> {
            const output = `[DEMO STUB: ${request.task}]\n${request.text}\n\nThis is a simulated suggestion, not model output.`;
            for (const chunk of output.match(/.{1,12}|\n/gu) ?? []) {
                await new Promise<void>((resolve, reject) => {
                    if (signal.aborted) { reject(new Error('Cancelled')); return; }
                    const stopped = () => { clearTimeout(timer); reject(new Error('Cancelled')); };
                    const timer = setTimeout(() => { signal.removeEventListener('abort', stopped); resolve(); }, 80);
                    signal.addEventListener('abort', stopped, { once: true });
                });
                if (this.fail) throw new Error('Simulated model unavailable. Document unchanged.');
                emit(chunk);
            }
            return output;
        }
    }
}
