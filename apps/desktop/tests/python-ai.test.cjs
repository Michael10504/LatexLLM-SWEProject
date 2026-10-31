const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PythonAiClient } = require('../dist/main/ai/PythonAiClient');
const root = path.resolve(__dirname, '../../../services/local-ai');

test('actual Python IPC streams a recorded response, rejects VIEWER, and recovers after cancellation', async () => {
    const client = new PythonAiClient({ root, python: process.env.LTX_PYTHON || 'python', stub: true });
    try {
        const chunks = [];
        const result = await client.run({ id: 'first', task: 'clarity', text: 'Selected text.', role: 'EDITOR' }, new AbortController().signal,
            event => { if (event.event === 'token') chunks.push(event.text); });
        assert.equal(result.stub, true);
        assert.match(result.text, /Selected text\./);
        assert.equal(chunks.join(''), result.text);
        await assert.rejects(client.run({ id: 'viewer', task: 'clarity', text: 'source', role: 'VIEWER' }, new AbortController().signal, () => {}), /Viewers/);
        const controller = new AbortController();
        const pending = client.run({ id: 'cancelled', task: 'clarity', text: 'word '.repeat(200), role: 'OWNER' }, controller.signal,
            event => { if (event.event === 'token') controller.abort(); });
        await assert.rejects(pending, /stopped|discarded/);
        const next = await client.run({ id: 'next', task: 'grammar', text: 'Next request.', role: 'OWNER' }, new AbortController().signal, () => {});
        assert.match(next.text, /Next request/);
    } finally { await client.stop(); }
});
