const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PDFDocument } = require('pdf-lib');
const { createWs6, InMemorySettingsStore, Consent, exactPageCounter } = require('@latexllm/cloud-summary');

test('real HTTP/auth/PDF relay: privacy gates, fresh consent on retry, readonly output and upstream cancellation', { timeout: 60000 }, async () => {
    const root = path.resolve(__dirname, '../..');
    const folder = path.join(root, '.cache/http-tests'); fs.mkdirSync(folder, { recursive: true });
    const database = path.join(folder, `test-${process.pid}-${Date.now()}.db`); fs.closeSync(fs.openSync(database, 'wx'));
    process.env.DATABASE_URL = `file:${database.split(path.sep).join('/')}`;
    process.env.NODE_ENV = 'test'; process.env.CLOUD_SUMMARY_STUB = '1';
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'apps/server/prisma/schema.prisma')],
        { env: process.env, cwd: root, stdio: 'pipe', timeout: 30000 });
    const { app } = require('../../apps/server/dist/app');
    const { prisma } = require('../../apps/server/dist/config/db');
    const { summarizationController } = require('../../apps/server/dist/controllers/SummarizationController');
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    let uploads = 0; server.on('request', request => { if (request.url === '/summarize') uploads++; });
    let token = null, answer = false;
    const consents = [], panels = [], errors = [];
    const base = `http://127.0.0.1:${server.address().port}`;
    const flow = createWs6({ settingsStore: new InMemorySettingsStore(true),
        session: { hasSession: () => !!token, getSessionToken: () => token },
        server: { serverBaseUrl: base }, gatewayOptions: { allowInsecureLoopback: true }, pageCounter: exactPageCounter,
        consentDialog: { show: async request => {
            consents.push(request); return answer ? Consent.grant(request.fileName, request.provider) : null;
        } },
        summaryPanel: { showReadOnly: (name, summary) => panels.push({ name, summary }) },
        feedback: { showProgress() {}, clearProgress() {}, showError: async (message, options) => { errors.push(message); return options.retry; } },
        requireLogin() {}
    });
    try {
        assert.equal(flow.summarization.start().status, 'blocked-local-only');
        assert.equal(consents.length, 0); assert.equal(uploads, 0);
        flow.settings.setLocalOnly(false);
        const username = `http_${Date.now().toString(36)}`;
        const credentials = JSON.stringify({ username, password: 'Integration!Password123' });
        const request = route => flow.gateway.send(base+route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: credentials }, { externalIntent: true });
        assert.equal((await request('/register')).status, 201);
        token = (await (await request('/login')).json()).token;
        assert.ok(token);
        const pdf = await PDFDocument.create(); pdf.addPage();
        const file = { name: 'paper.pdf', bytes: await pdf.save() };
        assert.equal((await flow.summarization.summarize(file)).status, 'cancelled');
        assert.equal(uploads, 0);
        answer = true;
        assert.equal((await flow.summarization.summarize(file)).status, 'shown');
        assert.equal(uploads, 1); assert.match(panels[0].summary, /DEMO STUB/);

        let attempts = 0;
        summarizationController.setCloudProviderFn(async () => {
            if (++attempts === 1) throw new Error('Injected transient outage');
            return 'Read-only test summary';
        });
        const before = consents.length;
        const retry = await flow.summarization.summarize(file);
        assert.equal(retry.status, 'shown'); assert.equal(retry.attempts, 2);
        assert.equal(consents.length-before, 2); assert.equal(uploads, 3);

        const many = await PDFDocument.create(); for (let index = 0; index < 101; index++) many.addPage();
        const consentCount = consents.length;
        const tooLong = await flow.summarization.summarize({ name: 'long.pdf', bytes: await many.save() });
        assert.equal(tooLong.status, 'invalid'); assert.equal(consents.length, consentCount); assert.equal(uploads, 3);

        let started;
        const providerStarted = new Promise(resolve => { started = resolve; });
        let stopped = false;
        summarizationController.setCloudProviderFn((_buffer, _name, _key, signal) => new Promise((_resolve, reject) => {
            started(); signal.addEventListener('abort', () => { stopped = true; reject(new Error('Aborted')); });
        }));
        const pending = flow.summarization.summarize(file); await providerStarted;
        flow.settings.setLocalOnly(true);
        assert.equal((await pending).status, 'blocked-local-only');
        for (let attempt = 0; attempt < 50 && !stopped; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(stopped, true);
        assert.equal(flow.gateway.inFlightCount(), 0);
    } finally {
        await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
    }
});
