const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { WS5 } = require('../dist/controller.js');
const { Controller, tasks } = WS5;
const input = selection => ({ selection, compileLog: '' });

test('exactly eight tasks are available', () => {
    assert.equal(tasks.length, 8);
    assert.equal(new Set(tasks.map(([id]) => id)).size, 8);
});
test('empty selection does not call the engine', async () => {
    let calls = 0;
    const c = new Controller({ run: async () => { calls++; return 'result'; } }, () => {});
    await c.run('grammar', input('  '));
    assert.equal(calls, 0);
    assert.equal(c.snapshot().status, 'failed');
});
test('only supplied selection is forwarded and source input remains unchanged', async () => {
    const source = input('chosen sentence');
    let received;
    const c = new Controller({ run: async request => { received = request; return 'suggestion'; } }, () => {});
    await c.run('grammar', source);
    assert.equal(received.text, 'chosen sentence');
    assert.equal(source.selection, 'chosen sentence');
    assert.equal(c.snapshot().output, 'suggestion');
});
test('1000 words accepted; 1001 rejected before calling engine', async () => {
    let calls = 0;
    const c = new Controller({ run: async () => { calls++; return 'result'; } }, () => {});
    await c.run('notes', input('word '.repeat(1000)));
    assert.equal(calls, 1);
    await c.run('notes', input('word '.repeat(1001)));
    assert.equal(calls, 1);
    assert.equal(c.snapshot().status, 'failed');
});
test('Task 8 uses compile log instead of selection', async () => {
    let received;
    const c = new Controller({ run: async request => { received = request; return 'demo patch'; } }, () => {});
    await c.run('latex', { selection: 'not the input', compileLog: 'error on line 5' });
    assert.equal(received.text, 'error on line 5');
});
test('missing compile log blocks Task 8', async () => {
    let calls = 0;
    const c = new Controller({ run: async () => { calls++; return 'result'; } }, () => {});
    await c.run('latex', input('selection'));
    assert.equal(calls, 0);
});
test('streaming publishes running state and completed result', async () => {
    const states = [];
    const c = new Controller({ run: async (r, s, emit) => { emit('partial'); return 'final'; } }, s => states.push(s));
    await c.run('clarity', input('source'));
    assert.ok(states.some(s => s.status === 'running' && s.output === 'partial'));
    assert.equal(c.snapshot().status, 'completed');
    assert.equal(c.snapshot().output, 'final');
});
test('cancel aborts request, clears partial output, ignores late chunks and result', async () => {
    let finish, emitLate, signal;
    const c = new Controller({ run: (r, s, emit) => {
        signal = s; emitLate = emit; emit('partial');
        return new Promise(resolve => { finish = resolve; });
    } }, () => {});
    const pending = c.run('grammar', input('source'));
    c.cancel();
    assert.equal(signal.aborted, true);
    emitLate('late'); finish('late result'); await pending;
    assert.equal(c.snapshot().status, 'cancelled');
    assert.equal(c.snapshot().output, '');
});
test('duplicate run while busy is ignored', async () => {
    let calls = 0, finish;
    const c = new Controller({ run: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }, () => {});
    const pending = c.run('grammar', input('source'));
    await c.run('tone', input('other source'));
    assert.equal(calls, 1);
    finish('done'); await pending;
});
test('failed generation clears partial output', async () => {
    const c = new Controller({ run: async (r, s, emit) => { emit('partial'); throw new Error('unavailable'); } }, () => {});
    await c.run('grammar', input('source'));
    assert.equal(c.snapshot().status, 'failed');
    assert.equal(c.snapshot().output, '');
});
test('empty generation is a failure', async () => {
    const c = new Controller({ run: async () => ' ' }, () => {});
    await c.run('grammar', input('source'));
    assert.equal(c.snapshot().status, 'failed');
});
test('staging fields are read-only and there is no editor save/apply path', () => {
    const html = fs.readFileSync('../../reference/ws5-ai-ui-qa/src/renderer/ws5-demo.html', 'utf8');
    assert.match(html, /id="ws5-original" readonly/);
    assert.match(html, /id="ws5-output" readonly/);
    const ui = fs.readFileSync('../../reference/ws5-ai-ui-qa/src/renderer/ai-panel-ui.ts', 'utf8');
    assert.doesNotMatch(ui, /innerHTML|saveFile|writeFile|dispatchTransaction/);
});
