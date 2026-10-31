(() => {
    const select = document.getElementById('ws5-task') as HTMLSelectElement | null;
    if (!select) return;
    const run = document.getElementById('ws5-run') as HTMLButtonElement;
    const cancel = document.getElementById('ws5-cancel') as HTMLButtonElement;
    const status = document.getElementById('ws5-status')!;
    const progress = document.getElementById('ws5-progress') as HTMLProgressElement;
    const original = document.getElementById('ws5-original') as HTMLTextAreaElement;
    const output = document.getElementById('ws5-output') as HTMLTextAreaElement;
    const sample = document.getElementById('ws5-source') as HTMLTextAreaElement | null;
    const log = document.getElementById('ws5-log') as HTMLTextAreaElement | null;
    const fail = document.getElementById('ws5-fail') as HTMLInputElement | null;
    const inputLabel = document.getElementById('ws5-input-label')!;
    const selectionLabel = document.getElementById('ws5-selection-status')!;
    const demo = sample !== null;
    let selectedText = '';
    let sourceSnapshot = '';

    for (const [value, label] of WS5.tasks) select.add(new Option(label, value));
    const repaint = (state: WS5.State) => {
        const running = state.status === 'running';
        run.disabled = running;
        select!.disabled = running;
        cancel.hidden = !running;
        progress.hidden = !running;
        status.textContent = state.message;
        status.dataset.state = state.status;
        original.value = state.original;
        output.value = state.output;
    };
    // A new Engine implementation is the integration point for Member 4.
    const engine: WS5.Engine = {
        run(request, signal, emit) { return new WS5.StubEngine(fail?.checked ?? false).run(request, signal, emit); }
    };
    const controller = new WS5.Controller(engine, repaint);
    repaint(controller.snapshot());
    select.addEventListener('change', () => {
        inputLabel.textContent = select!.value === 'latex' ? 'Compile-log input' : 'Original selected text';
    });
    const captureSelection = () => {
        if (!sample) return;
        selectedText = sample.value.slice(sample.selectionStart, sample.selectionEnd);
        sourceSnapshot = sample.value;
        selectionLabel.textContent = selectedText ? `${selectedText.trim().split(/\s+/u).length} word(s) selected in the demo source.` : 'No text selected.';
    };
    sample?.addEventListener('select', captureSelection);
    sample?.addEventListener('keyup', captureSelection);
    sample?.addEventListener('mouseup', captureSelection);
    sample?.addEventListener('input', () => { selectedText = ''; sourceSnapshot = sample.value; selectionLabel.textContent = 'Select text again after editing.'; });
    run.addEventListener('click', () => {
        if (!demo) {
            status.textContent = 'Editor and model integration pending. Open the standalone WS-5 demo to test the stub.';
            return;
        }
        const selection = sample.value === sourceSnapshot ? selectedText : '';
        void controller.run(select!.value as WS5.Task, { selection, compileLog: log?.value ?? '' });
    });
    cancel.addEventListener('click', () => controller.cancel());
    window.addEventListener('pagehide', () => controller.cancel());
})();
