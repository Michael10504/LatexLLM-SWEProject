import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { AiEvent, AiResult, LocalTask, Role } from '../../shared/integration';

export interface PythonAiOptions { root: string; python?: string; stub?: boolean; }
export class PythonAiClient {
    private child?: ChildProcessWithoutNullStreams;
    private active?: { id: string; resolve(value: AiResult): void; reject(error: Error): void; emit(event: AiEvent): void; cleanup(): void };
    private stopping?: Promise<void>;
    constructor(private readonly options: PythonAiOptions) {}

    private launch(): void {
        if (this.child) return;
        const candidate = path.resolve(this.options.root, '../../.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        const python = this.options.python || (existsSync(candidate) ? candidate : 'python');
        const environment = { ...process.env };
        delete environment.CLOUD_SUMMARY_API_KEY;
        delete environment.CREDENTIAL_MASTER_SECRET;
        delete environment.HF_TOKEN;
        const child = spawn(python, ['-u', path.join(this.options.root, 'worker.py'), ...(this.options.stub ? ['--stub'] : [])], {
            cwd: this.options.root, windowsHide: true, stdio: 'pipe',
            env: { ...environment, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', DO_NOT_TRACK: '1' }
        });
        this.child = child;
        const lines = readline.createInterface({ input: child.stdout });
        // Consume diagnostics without persisting prompts or flooding the UI.
        child.stderr.on('data', () => {});
        lines.on('line', line => {
            let frame: { id: string; event: string; text?: string; status?: string; message?: string; stub?: boolean };
            try { frame = JSON.parse(line); } catch { this.fail(new Error('Invalid local runtime response.')); void this.stop(); return; }
            const active = this.active;
            if (!active || frame.id !== active.id) return;
            if (frame.event === 'token' || frame.event === 'status') {
                active.emit({ id: frame.id, event: frame.event, text: frame.text, status: frame.status });
            } else if (frame.event === 'result') {
                this.active = undefined; active.cleanup();
                if (typeof frame.text !== 'string' || !frame.text.trim()) active.reject(new Error('Local model returned no text.'));
                else active.resolve({ text: frame.text, stub: frame.stub === true });
            } else if (frame.event === 'error') this.fail(new Error(frame.message || 'Local inference failed. Document unchanged.'));
        });
        child.on('error', () => this.fail(new Error('Python runtime unavailable. Run the setup instructions in README.md.')));
        child.on('close', () => {
            lines.close();
            if (this.child === child) this.child = undefined;
            this.fail(new Error('Local runtime stopped. Partial output discarded; document unchanged.'));
        });
    }

    private fail(error: Error): void {
        const active = this.active; this.active = undefined;
        if (active) { active.cleanup(); active.reject(error); }
    }

    async run(request: { id: string; task: LocalTask; text: string; role: Role }, signal: AbortSignal, emit: (event: AiEvent) => void): Promise<AiResult> {
        if (this.stopping) await this.stopping;
        if (this.active) throw new Error('Another local AI task is running.');
        if (signal.aborted) throw new Error('Cancelled.');
        this.launch();
        return new Promise<AiResult>((resolve, reject) => {
            const abort = () => { void this.stop(); };
            signal.addEventListener('abort', abort, { once: true });
            this.active = { id: request.id, resolve, reject, emit, cleanup: () => signal.removeEventListener('abort', abort) };
            this.child!.stdin.write(JSON.stringify(request) + '\n', error => { if (error) this.fail(new Error('Local runtime input failed.')); });
            if (signal.aborted) abort();
        });
    }

    async cancel(id: string): Promise<boolean> {
        if (!this.active || this.active.id !== id) return false;
        await this.stop(); return true;
    }

    stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        const child = this.child;
        if (!child) return Promise.resolve();
        this.stopping = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Local runtime did not acknowledge termination.')), 5000);
            child.once('close', () => { clearTimeout(timer); resolve(); });
            child.kill();
        }).finally(() => { this.stopping = undefined; });
        return this.stopping;
    }
}
