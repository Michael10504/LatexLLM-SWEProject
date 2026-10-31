import { WS5 } from '@latexllm/ai-panel';
import type { LocalTask } from '../../shared/integration';

export function mountAssistant(): void {
    const select = document.getElementById('ai-task') as HTMLSelectElement;
    const run = document.getElementById('ai-run') as HTMLButtonElement;
    const cancel = document.getElementById('ai-cancel') as HTMLButtonElement;
    const progress = document.getElementById('ai-progress')!;
    const status = document.getElementById('ai-status')!;
    const original = document.getElementById('ai-original') as HTMLTextAreaElement;
    const output = document.getElementById('ai-output') as HTMLTextAreaElement;
    const cloudRun = document.getElementById('cloud-run') as HTMLButtonElement;
    const cloudStatus = document.getElementById('cloud-status')!;
    const cloudOutput = document.getElementById('cloud-output') as HTMLTextAreaElement;
    const toggle = document.getElementById('local-only') as HTMLInputElement;
    const privacyStatus = document.getElementById('privacy-status')!;
    let localOnly = true;
    let activeId: string | undefined;
    let cloudBusy = false;
    for (const [value, label] of WS5.tasks) {
        const option = new Option(label + (['table','caption','latex'].includes(value) ? ' (Sprint 2)' : ''), value);
        option.disabled = ['table','caption','latex'].includes(value);
        select.add(option);
    }
    const refresh = () => {
        const snapshot = window.editorSelection?.();
        const allowed = !!snapshot?.projectId && snapshot.role !== 'VIEWER';
        run.disabled = !allowed || controller.snapshot().status === 'running';
        cloudRun.disabled = localOnly || cloudBusy;
        document.getElementById('selection-status')!.textContent = !snapshot?.projectId ? 'Open a project, then select text.'
            : snapshot.role === 'VIEWER' ? 'Viewers cannot run local AI tasks.'
            : snapshot.text.trim() ? `${snapshot.text.trim().split(/\s+/u).length} word(s) selected in ${snapshot.file}.` : 'Select text in the editor.';
    };
    const engine: WS5.Engine = {
        async run(request, signal, emit) {
            const snapshot = window.editorSelection?.();
            if (!snapshot?.projectId) throw new Error('Open a project first.');
            const id = crypto.randomUUID(); activeId = id;
            const unsubscribe = window.integration.localAI.onEvent(event => {
                if (event.id !== id || signal.aborted) return;
                if (event.event === 'token') emit(event.text || '');
                else if (event.status?.startsWith('Runtime:')) document.getElementById('ai-mode')!.textContent = event.status;
                else status.textContent = event.status === 'loading' ? 'Loading the local model…' : event.status === 'preparing' ? 'Preparing the loaded model…' : 'Generating locally…';
            });
            const abort = () => { void window.integration.localAI.cancel(id).catch(() => {}); };
            signal.addEventListener('abort', abort, { once: true });
            try {
                if (signal.aborted) throw new Error('Cancelled.');
                const result = await window.integration.localAI.run({ id, projectId: snapshot.projectId,
                    task: request.task as LocalTask, text: request.text });
                return result.text;
            } finally {
                signal.removeEventListener('abort', abort); unsubscribe();
                if (activeId === id) activeId = undefined;
            }
        }
    };
    const controller = new WS5.Controller(engine, state => {
        const running = state.status === 'running';
        select.disabled = running; cancel.hidden = !running; progress.hidden = !running;
        original.value = state.original; output.value = state.output;
        status.textContent = state.message; status.dataset.state = state.status;
        refresh();
    });
    run.addEventListener('click', () => {
        const snapshot = window.editorSelection?.();
        void controller.run(select.value as WS5.Task, { selection: snapshot?.text || '', compileLog: '' });
    });
    cancel.addEventListener('click', () => controller.cancel());
    const reset = () => {
        controller.cancel(); original.value = ''; output.value = ''; cloudOutput.value = ''; refresh();
    };
    window.addEventListener('app:projectOpened', reset);
    window.addEventListener('app:projectClosed', reset);
    window.addEventListener('pagehide', () => { controller.cancel(); if (activeId) void window.integration.localAI.cancel(activeId); });
    document.addEventListener('selectionchange', refresh);
    document.addEventListener('keyup', refresh);
    document.addEventListener('mouseup', refresh);
    window.integration.localAI.info().then(info => {
        document.getElementById('ai-mode')!.textContent = info.stub ? 'DEMO: recorded responses, not model output.' : 'Local model — text stays on this device.';
    }).catch(error => { status.textContent = String(error); });
    const showPrivacy = (on: boolean) => {
        localOnly = on; toggle.checked = on;
        privacyStatus.textContent = on ? 'Local Only: external requests blocked' : 'Online functions available';
        refresh();
    };
    toggle.disabled = true;
    window.integration.privacy.get().then(value => { showPrivacy(value.localOnly); toggle.disabled = false; })
        .catch(error => { privacyStatus.textContent = `Privacy settings unavailable: ${String(error)}`; });
    toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try { showPrivacy((await window.integration.privacy.set(toggle.checked)).localOnly); }
        catch (error) { toggle.checked = localOnly; privacyStatus.textContent = String(error); }
        finally { toggle.disabled = false; }
    });
    const settingsStatus = document.getElementById('cloud-settings-status')!;
    const provider = document.getElementById('cloud-provider') as HTMLSelectElement;
    const model = document.getElementById('cloud-model') as HTMLInputElement;
    const endpoint = document.getElementById('cloud-endpoint') as HTMLInputElement;
    const key = document.getElementById('cloud-key') as HTMLInputElement;
    const loadSettings = async () => {
        const value = await window.integration.cloud.settings();
        provider.value = value.provider; model.value = value.model; endpoint.value = value.endpoint; key.value = '';
        settingsStatus.textContent = (value.configured ? 'API settings saved to this account. Key is hidden.' : 'No account API key saved.')
            + (value.demo ? ' DEMO cloud mode is active: restart with python scripts/run.py to use the live API.' : ' Live provider mode.');
    };
    const settingsAction = async (action: () => Promise<unknown>) => {
        settingsStatus.textContent = 'Updating account API settings…';
        try { await action(); await loadSettings(); }
        catch (error) { settingsStatus.textContent = String(error); }
        finally { key.value = ''; }
    };
    document.getElementById('cloud-settings-load')!.addEventListener('click', () => void settingsAction(async () => {}));
    document.getElementById('cloud-settings-save')!.addEventListener('click', () => void settingsAction(() => window.integration.cloud.saveSettings({ provider: provider.value, model: model.value, endpoint: endpoint.value, apiKey: key.value })));
    document.getElementById('cloud-settings-delete')!.addEventListener('click', () => void settingsAction(() => window.integration.cloud.deleteSettings()));
    window.addEventListener('app:projectClosed', () => { key.value = ''; settingsStatus.textContent = ''; endpoint.value = ''; });
    cloudRun.addEventListener('click', async () => {
        cloudBusy = true; refresh(); cloudStatus.textContent = 'Preparing paper summary…';
        try {
            const result = await window.integration.cloud.summarize();
            if (result.status === 'cancelled') cloudStatus.textContent = 'Cancelled. No new request was sent.';
            if (result.status === 'configuration-required') {
                (document.getElementById('cloud-settings') as HTMLDetailsElement).open = true;
                await loadSettings(); cloudStatus.textContent = 'Enter your Gemini API key and click Save to my account, then try again.';
            }
        } catch (error) { cloudStatus.textContent = String(error); }
        finally { cloudBusy = false; refresh(); }
    });
    window.integration.cloud.onEvent(event => {
        if (event.kind === 'summary') {
            cloudStatus.textContent = `${event.fileName} — read-only summary`;
            cloudOutput.value = event.summary || '';
        } else if (event.message) cloudStatus.textContent = event.message;
        if (event.kind === 'login-required') document.getElementById('auth-overlay')!.style.display = 'flex';
    });
    refresh();
}
