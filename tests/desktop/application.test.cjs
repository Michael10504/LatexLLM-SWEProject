const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright-core');
const { PDFDocument } = require('pdf-lib');

// Poll through DevTools calls rather than injecting an eval-based waiter into
// the application, whose production CSP intentionally disallows unsafe-eval.
async function waitFor(page, predicate) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (await page.evaluate(predicate)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Desktop state did not become ready within 30 seconds.');
}

test('integrated desktop: auth, selected-text AI, cancellation, compile, consent, privacy and offline restart', { timeout: 180000 }, async () => {
    const root = path.resolve(__dirname, '../..');
    const artifacts = path.join(root, '.cache/desktop-smoke');
    fs.mkdirSync(artifacts, { recursive: true });
    const userData = fs.mkdtempSync(path.join(artifacts, 'profile-'));
    process.env.NODE_ENV = 'test';
    process.env.CLOUD_SUMMARY_STUB = '1';
    const database = path.join(userData, 'server.db');
    fs.closeSync(fs.openSync(database, 'a'));
    process.env.DATABASE_URL = `file:${database.split(path.sep).join('/')}`;
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'apps/server/prisma/schema.prisma')],
        { cwd: root, env: process.env, stdio: 'pipe', timeout: 60000 });
    const { app } = require('../../apps/server/dist/app');
    const { prisma } = require('../../apps/server/dist/config/db');
    const { summarizationController } = require('../../apps/server/dist/controllers/SummarizationController');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let summaries = 0;
    server.on('request', request => { if (request.url === '/summarize') summaries++; });
    const environment = { ...process.env, ELECTRON_RUN_AS_NODE: undefined, LTX_HEADLESS: '1',
        LTX_USER_DATA: userData, LTX_STUB_AI: '1', LTX_STUB_COMPILE: '1',
        LTX_SERVER_URL: `http://127.0.0.1:${server.address().port}` };
    let desktop;
    const launch = async () => {
        // Software Chromium rendering makes this hidden UI test independent of
        // the host display driver. It does not change Python model offloading.
        desktop = await _electron.launch({
            args: ['--disable-gpu', '--in-process-gpu', path.join(root, 'apps/desktop')], env: environment, timeout: 30000 });
        const page = await desktop.firstWindow();
        page.on('pageerror', error => console.error('Renderer:', error.message));
        page.on('console', event => { if (event.type() === 'error') console.error('Browser:', event.text()); });
        await waitFor(page, () => !!window.integration && !!window.editorSelection);
        return page;
    };
    try {
        const page = await launch();
        console.log('Desktop launched');
        const username = `integration_${Date.now().toString(36)}`;
        await page.locator('#username-input').fill(username);
        await page.locator('#password-input').fill('Integration!Password123');
        await page.locator('#auth-submit-btn').click();
        await waitFor(page, () => document.querySelector('#auth-error').textContent === 'Invalid username or password.');
        await page.locator('#auth-toggle-btn').click();
        await page.locator('#username-input').fill(username);
        await page.locator('#password-input').fill('Integration!Password123');
        await page.locator('#auth-submit-btn').click();
        await page.locator('#project-overlay').waitFor({ state: 'visible' });
        console.log('Authentication passed');
        await page.locator('#new-project-name').fill('Integrated workspace');
        await page.locator('#create-project-btn').click();
        await page.locator('.project-info').first().click();
        await page.locator('.cm-content').waitFor();
        await page.locator('#cloud-settings').evaluate(element => { element.open = true; });
        await page.locator('#cloud-settings-load').click();
        await waitFor(page, () => document.querySelector('#cloud-settings-status').textContent.includes('No account API key saved'));
        await page.locator('#cloud-key').fill('synthetic-desktop-fixture-key');
        await page.locator('#cloud-settings-save').click();
        await waitFor(page, () => document.querySelector('#cloud-settings-status').textContent.includes('API settings saved'));
        assert.equal(await page.locator('#cloud-key').inputValue(), '');
        assert.equal((await page.evaluate(() => window.integration.cloud.settings())).configured, true);
        await page.locator('#cloud-settings-delete').click();
        await waitFor(page, () => document.querySelector('#cloud-settings-status').textContent.includes('No account API key saved'));
        await page.locator('#cloud-settings').evaluate(element => { element.open = false; });


        const source = await page.evaluate(() => window.editorSelection().document);
        await page.evaluate(() => window.EditorView.setCursor(4));
        await page.keyboard.press('Home');
        await page.keyboard.down('Shift');
        for (let index = 0; index < 7; index++) await page.keyboard.press('ArrowRight');
        await page.keyboard.up('Shift');
        assert.equal(await page.evaluate(() => window.editorSelection().text), 'Welcome');
        await page.locator('#ai-task').selectOption('grammar');
        await page.locator('#ai-run').click();
        await waitFor(page, () => document.querySelector('#ai-status').dataset.state === 'completed');
        const proposal = await page.locator('#ai-output').inputValue();
        assert.match(proposal, /Welcome/); assert.doesNotMatch(proposal, /documentclass/);
        assert.equal(await page.evaluate(() => window.editorSelection().document), source);
        assert.equal(await page.locator('#ai-output').getAttribute('readonly'), '');
        console.log('Selected-text streaming passed');

        await page.evaluate(async () => {
            document.querySelector('#ai-run').click();
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('No cancellable stream appeared')); }, 10000);
                const poll = setInterval(() => {
                    const cancel = document.querySelector('#ai-cancel');
                    if (!cancel.hidden && document.querySelector('#ai-output').value.length > 0) {
                        cancel.click(); clearInterval(poll); clearTimeout(timeout); resolve();
                    }
                }, 5);
            });
        });
        assert.equal(await page.locator('#ai-output').inputValue(), '');
        assert.equal(await page.evaluate(() => window.editorSelection().document), source);

        // Real main-process role checks must reject a forged renderer request.
        console.log('Cancellation passed');
        const current = await page.evaluate(() => window.editorSelection());
        const forged = await page.evaluate(async () => {
            try { await window.integration.localAI.run({ id: 'forged', projectId: 'not-owned', task: 'grammar', text: 'text' }); return false; }
            catch { return true; }
        });
        assert.equal(forged, true);
        const compile = await page.evaluate(id => window.ws3.compile(id), current.projectId);
        assert.equal(compile.status, 'SUCCESS');
        await page.locator('.ws3-toolbar button.primary').click();
        try { await page.locator('.ws3-pages canvas.page').first().waitFor({ state: 'visible', timeout: 15000 }); }
        catch (error) { console.error('Preview:', await page.locator('#pdf-preview').innerText()); await page.screenshot({path:path.join(artifacts,'preview-failure.png')}); throw error; }
        console.log('Compile bridge and visible PDF passed');
        assert.equal(await page.evaluate(() => window.editorSelection().document), source);

        process.env.CLOUD_SUMMARY_STUB = '0';
        await page.locator('#cloud-run').click();
        await waitFor(page, () => document.querySelector('#cloud-output').value === '' && document.querySelector('#cloud-status').textContent.includes('Enter your Gemini API key'));
        assert.equal(await page.locator('#cloud-settings').evaluate(element => element.open), true);
        process.env.CLOUD_SUMMARY_STUB = '1';
        await page.locator('#cloud-settings').evaluate(element => { element.open = false; });

        const pdf = await PDFDocument.create(); pdf.addPage();
        const pdfPath = path.join(userData, 'paper.pdf'); fs.writeFileSync(pdfPath, await pdf.save());
        await desktop.evaluate(({ dialog }, selected) => {
            globalThis.__consents = []; globalThis.__picks = 0;
            dialog.showOpenDialog = async () => { globalThis.__picks++; return { canceled: false, filePaths: [selected] }; };
            dialog.showMessageBox = async (_window, options) => {
                if (options.title === 'Send paper for summarization?') { globalThis.__consents.push(options); return { response: 0 }; }
                return { response: options.buttons.includes('Cancel') ? options.buttons.indexOf('Cancel') : 0 };
            };
        }, pdfPath);
        await page.locator('#cloud-run').click();
        await waitFor(page, () => document.querySelector('#cloud-output').value.includes('DEMO STUB'));
        assert.equal(summaries, 1);
        const consents = await desktop.evaluate(() => globalThis.__consents);
        assert.equal(consents.length, 1);
        console.log('Cloud consent and response passed');
        assert.match(consents[0].detail, /whole file.*third-party/);
        assert.equal(await page.evaluate(() => window.editorSelection().document), source);

        let providerStarted;
        const started = new Promise(resolve => { providerStarted = resolve; });
        let upstreamAborted = false;
        summarizationController.setCloudProviderFn((_buffer, _name, _key, signal) => new Promise((_resolve, reject) => {
            providerStarted(); signal.addEventListener('abort', () => { upstreamAborted = true; reject(new Error('Cancelled')); });
        }));
        await page.locator('#cloud-run').click();
        await Promise.race([started, new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error('Cloud retry did not reach the provider')), 15000); timer.unref();
        })]);
        await page.locator('#local-only').check();
        for (let tries = 0; tries < 50 && !upstreamAborted; tries++) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(upstreamAborted, true);
        assert.equal(await page.locator('#cloud-run').isDisabled(), true);
        const before = summaries;
        await page.evaluate(() => window.integration.cloud.summarize());
        assert.equal(summaries, before);
        assert.equal(await desktop.evaluate(() => globalThis.__picks), 2);
        assert.equal((await desktop.evaluate(() => globalThis.__consents)).length, 2);

        // The Local Only setting must not disable the local Python path.
        await page.locator('#ai-run').click();
        await waitFor(page, () => document.querySelector('#ai-status').dataset.state === 'completed');
        await page.screenshot({ path: path.join(artifacts, 'integrated-app.png') });
        const canRestore = fs.existsSync(path.join(userData, 'session.enc'));
        await desktop.close(); desktop = undefined;
        const restarted = await launch();
        await waitFor(restarted, () => document.querySelector('#local-only').checked && !document.querySelector('#local-only').disabled);
        assert.equal((await restarted.evaluate(() => window.integration.privacy.get())).localOnly, true);
        if (canRestore) {
            await restarted.locator('.project-info').first().waitFor();
            await restarted.locator('.project-info').first().click();
            await restarted.locator('.cm-content').waitFor();
            assert.equal(await restarted.evaluate(() => window.editorSelection().document), source);
        } else {
            // Do not substitute plaintext storage or an unauthenticated session
            // when the platform has no usable OS-backed credential encryption.
            assert.equal(await restarted.locator('#auth-overlay').isVisible(), true);
        }
    } finally {
        if (desktop) await desktop.close();
        await new Promise(resolve => server.close(resolve));
        await prisma.$disconnect();
    }
});
