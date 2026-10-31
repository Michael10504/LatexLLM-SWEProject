import { BrowserWindow, dialog, safeStorage, type IpcMain, type IpcMainInvokeEvent } from 'electron';

import path from 'node:path';

import fs from 'node:fs/promises';

import * as syncFs from 'node:fs';

import {

    createWs6, FileSettingsStore, Consent, PdfValidator, exactPageCounter,

    type SummarizeOutcome

} from '@latexllm/cloud-summary';

import { PythonAiClient } from './ai/PythonAiClient';

import type { AiRequest, Role } from '../shared/integration';

import type { ProjectRepository } from './ProjectRepository';



const LOCAL_TASKS = ['notes', 'outline', 'clarity', 'tone', 'grammar'] as const;

export function registerIntegration(ipc: IpcMain, options: {

    userData: string; root: string; projects: ProjectRepository; window: () => BrowserWindow | undefined;

}) {

    let identity: { username: string; token: string } | undefined;

    const sessionFile = path.join(options.userData, 'session.enc');

    const persistIdentity = () => {

        if (!identity || !safeStorage.isEncryptionAvailable()) return;

        try {

            syncFs.writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify({ ...identity, expires: Date.now()+8*60*60*1000 })));

        } catch { /* An unavailable OS keychain disables restoration, not a valid online login. */ }

    };

    const python = new PythonAiClient({ root: process.env.LTX_LOCAL_AI_DIR || path.join(options.root, 'services/local-ai'),

        python: process.env.LTX_PYTHON, stub: process.env.LTX_STUB_AI === '1' });

    let cloudBusy = false;

    let cloudProviderLabel = 'Cloud Summarization Service';

    let identityRevision = 0;

    let cloudRevision = 0;

    const currentWindow = () => {

        const window = options.window();

        if (!window || window.isDestroyed()) throw new Error('Application window unavailable.');

        return window;

    };

    const notify = (event: { kind: string; message?: string; fileName?: string; summary?: string }) => {

        if (cloudBusy && cloudRevision !== identityRevision) return;

        const window = options.window();

        if (window && !window.isDestroyed()) window.webContents.send('cloud:event', event);

    };

    const session = { hasSession: () => !!identity?.token, getSessionToken: () => identity?.token || null };

    const serverBaseUrl = process.env.LTX_SERVER_URL || 'http://127.0.0.1:3443';

    const cloud = createWs6({

        settingsStore: new FileSettingsStore(path.join(options.userData, 'settings.json')),

        session, server: { serverBaseUrl, providerName: process.env.LTX_CLOUD_PROVIDER_NAME || 'Cloud Summarization Service' },

        gatewayOptions: { allowInsecureLoopback: true }, pageCounter: exactPageCounter,

        requireLogin: () => notify({ kind: 'login-required', message: 'Sign in before summarizing a paper.' }),

        consentDialog: { show: async request => {

            if (cloudRevision !== identityRevision) return null;

            const answer = await dialog.showMessageBox(currentWindow(), { type: 'question', title: 'Send paper for summarization?',

                message: request.fileName,

                detail: `Size: ${request.sizeBytes} bytes\nProvider: ${cloudProviderLabel}\n\n${request.statement}`,

                buttons: ['Send', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });

            return answer.response === 0 && cloudRevision === identityRevision ? Consent.grant(request.fileName, request.provider) : null;

        } },

        summaryPanel: { showReadOnly: (fileName, summary) => notify({ kind: 'summary', fileName, summary }) },

        feedback: {

            showProgress: message => notify({ kind: 'progress', message }),

            clearProgress: () => notify({ kind: 'idle' }),

            showError: async (message, retry) => {

                if (cloudBusy && cloudRevision !== identityRevision) return false;

                notify({ kind: 'error', message });

                const answer = await dialog.showMessageBox(currentWindow(), { type: 'error', title: 'Paper summary', message,

                    buttons: retry.retry ? ['Retry', 'Cancel'] : ['OK'], defaultId: retry.retry ? 1 : 0,

                    cancelId: retry.retry ? 1 : 0, noLink: true });

                return retry.retry && answer.response === 0;

            }

        }

    });

    const handle = (channel: string, fn: (event: IpcMainInvokeEvent, data: any) => unknown) => {

        ipc.handle(channel, (event, data) => {

            if (event.sender.id !== currentWindow().webContents.id) throw new Error('Untrusted application window.');

            return fn(event, data);

        });

    };

    const requireUser = () => {

        if (!identity) throw new Error('Sign in before opening a project.');

        return identity.username;

    };

    const project = (id: unknown, edit = false, owner = false) => {

        const username = requireUser();

        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('Invalid project identifier.');

        const item = options.projects.getProject(id);

        if (!item || item.ownerId !== username) throw new Error('Project access denied.');

        if (edit && item.role === 'VIEWER') throw new Error('Viewers cannot edit files or run AI tasks.');

        if (owner && item.role !== 'OWNER') throw new Error('Only the owner can delete this project.');

        return item;

    };

    const authRequest = async (route: string, body?: unknown, token?: string, method = 'POST') => {

        const response = await cloud.gateway.send(new URL(route, serverBaseUrl).href, {

            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },

            body: body === undefined ? undefined : JSON.stringify(body)

        }, { timeoutMs: 15000, externalIntent: true });

        const data = await response.json() as any;

        data.message ||= data.violatedRule || data.error;

        return { response, data };

    };

    handle('auth:register', async (_event, data) => {

        try {

            if (typeof data?.username !== 'string' || typeof data?.password !== 'string') throw new Error('Invalid credentials.');

            const result = await authRequest('/register', data);

            return { success: result.response.ok, message: result.data.message };

        } catch (error) { return { success: false, message: error instanceof Error ? error.message : 'Registration failed.' }; }

    });

    handle('auth:login', async (_event, data) => {

        try {

            if (typeof data?.username !== 'string' || typeof data?.password !== 'string') throw new Error('Invalid credentials.');

            const result = await authRequest('/login', data);

            if (!result.response.ok || !result.data.token) return { success: false, message: result.data.message || 'Login failed.' };

            await python.stop();

            identityRevision++;

            identity = { username: data.username, token: result.data.token };

            persistIdentity();

            return { success: true, user: { username: identity.username } };

        } catch (error) { return { success: false, message: error instanceof Error ? error.message : 'Login failed.' }; }

    });

    handle('auth:logout', async () => {

        const previous = identity; identity = undefined;

        if (syncFs.existsSync(sessionFile)) syncFs.unlinkSync(sessionFile);

        identityRevision++;

        await python.stop();

        if (previous?.token) {

            try { await authRequest('/logout', undefined, previous.token); } catch { /* Always clear the local session. */ }

        }

    });

    handle('auth:restore', async () => {

        try {

            if (!safeStorage.isEncryptionAvailable() || !syncFs.existsSync(sessionFile)) return null;

            const saved = JSON.parse(safeStorage.decryptString(syncFs.readFileSync(sessionFile))) as { username: string; token: string; expires: number };

            if (typeof saved.username !== 'string' || typeof saved.token !== 'string' || saved.expires <= Date.now()) return null;

            // Offline restoration is limited to the last authenticated OS-encrypted

            // session and its eight-hour deadline. Online requests are still

            // independently checked by the server's session middleware.

            identity = { username: saved.username, token: saved.token };

            return { username: saved.username };

        } catch { return null; }

    });

    handle('auth:devLogin', () => {

        if (process.env.LTX_DEV !== '1') throw new Error('Development login is disabled.');

        identityRevision++;

        identity = { username: 'dev', token: '' }; return { username: 'dev' };

    });

    handle('privacy:get', () => ({ localOnly: cloud.settings.isLocalOnly() }));

    handle('privacy:set', (_event, data) => {

        if (typeof data !== 'boolean') throw new Error('Invalid privacy setting.');

        cloud.settings.setLocalOnly(data);

        return { localOnly: cloud.settings.isLocalOnly() };

    });

    handle('ai:info', () => ({ stub: process.env.LTX_STUB_AI === '1', tasks: [...LOCAL_TASKS] }));

    handle('ai:run', (event, request: AiRequest) => {

        const item = project(request?.projectId, true);

        if (typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id)) throw new Error('Invalid request identifier.');

        if (!LOCAL_TASKS.includes(request.task)) throw new Error('This task is deferred to Sprint 2.');

        if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('Please select text first.');

        if (request.text.trim().split(/\s+/u).length > 1000) throw new Error('Please select no more than 1,000 words.');

        if (request.text.length > 65536) throw new Error('Selection exceeds the transport limit; select less text.');

        return python.run({ id: request.id, task: request.task, text: request.text, role: item.role as Role }, new AbortController().signal,

            frame => { if (!event.sender.isDestroyed()) event.sender.send('ai:event', frame); });

    });

    handle('ai:cancel', async (_event, id) => {

        if (typeof id !== 'string') throw new Error('Invalid request identifier.');

        return { stopped: await python.cancel(id) };

    });

    const accountRequest = async (route: string, value?: unknown, method = 'POST') => {

        requireUser();

        const result = await authRequest(route, value, identity!.token, method);

        if (!result.response.ok) throw new Error(result.data.message || 'Account settings request failed.');

        return result.data;

    };

    handle('cloud:settings', () => accountRequest('/account/cloud', undefined, 'GET'));

    handle('cloud:saveSettings', (_event, value) => accountRequest('/account/cloud', value));

    handle('cloud:deleteSettings', () => accountRequest('/account/cloud/delete'));

    handle('cloud:summarize', async (): Promise<SummarizeOutcome | { status: 'configuration-required'; attempts: number }> => {

        if (cloudBusy) return { status: 'failed', reason: 'A summary request is already running.', attempts: 0 };

        cloudBusy = true;

        cloudRevision = identityRevision;

        try {

            const blocked = cloud.summarization.start(); if (blocked) return blocked;

            const settings = await accountRequest('/account/cloud', undefined, 'GET');
            if (!settings.demo && !settings.configured && !settings.serverConfigured) return { status: 'configuration-required', attempts: 0 };

            cloudProviderLabel = settings.demo ? 'DEMO cloud relay (no third-party call)' : settings.configured

                ? settings.provider === 'gemini' ? `Google Gemini (${settings.model})` : `Custom relay: ${settings.endpoint}`

                : process.env.LTX_CLOUD_PROVIDER_NAME || 'Cloud Summarization Service';

            const picked = await dialog.showOpenDialog(currentWindow(), { title: 'Choose a paper to summarize', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });

            if (cloudRevision !== identityRevision) return { status: 'cancelled', attempts: 0 };

            if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled', attempts: 0 };

            const selected = picked.filePaths[0];

            if ((await fs.stat(selected)).size > PdfValidator.MAX_BYTES) {

                notify({ kind: 'error', message: 'PDF exceeds the 20 MB limit. Nothing was transmitted.' });

                return { status: 'invalid', reason: 'PDF exceeds the 20 MB limit.' };

            }

            return await cloud.summarization.summarize({ name: path.basename(selected), bytes: new Uint8Array(await fs.readFile(selected)) });

        } finally { cloudBusy = false; }

    });

    return { requireUser, project, stop: () => python.stop() };

}

