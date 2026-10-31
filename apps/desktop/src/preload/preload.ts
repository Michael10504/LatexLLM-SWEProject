import { contextBridge, ipcRenderer } from 'electron';
import type { AiRequest, AiEvent, IntegrationApi } from '../shared/integration';

const integration: IntegrationApi = {
    auth: {
        register: (username, password) => ipcRenderer.invoke('auth:register', { username, password }),
        login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
        logout: () => ipcRenderer.invoke('auth:logout'),
        devLogin: () => ipcRenderer.invoke('auth:devLogin')
        ,restore: () => ipcRenderer.invoke('auth:restore')
    },
    privacy: { get: () => ipcRenderer.invoke('privacy:get'), set: value => ipcRenderer.invoke('privacy:set', value) },
    localAI: {
        run: (request: AiRequest) => ipcRenderer.invoke('ai:run', request),
        cancel: id => ipcRenderer.invoke('ai:cancel', id),
        info: () => ipcRenderer.invoke('ai:info'),
        onEvent: callback => {
            const listener = (_event: unknown, frame: AiEvent) => callback(frame);
            ipcRenderer.on('ai:event', listener);
            return () => ipcRenderer.removeListener('ai:event', listener);
        }
    },
    cloud: {
        settings: () => ipcRenderer.invoke('cloud:settings'),
        saveSettings: value => ipcRenderer.invoke('cloud:saveSettings', value),
        deleteSettings: () => ipcRenderer.invoke('cloud:deleteSettings'),
        summarize: () => ipcRenderer.invoke('cloud:summarize'),
        onEvent: callback => {
            const listener = (_event: unknown, event: Parameters<typeof callback>[0]) => callback(event);
            ipcRenderer.on('cloud:event', listener);
            return () => ipcRenderer.removeListener('cloud:event', listener);
        }
    }
};
contextBridge.exposeInMainWorld('integration', integration);

contextBridge.exposeInMainWorld('electronAPI', {
    ping: () => ipcRenderer.invoke('ping-main'),
    createProject: (data: { name: string; ownerId: string }) => ipcRenderer.invoke('create-project', data),
    listProjects: (data: { ownerId: string }) => ipcRenderer.invoke('list-projects', data),
    deleteProject: (data: { id: string }) => ipcRenderer.invoke('delete-project', data),
    readFile: (data: { projectId: string; relativePath: string }) => ipcRenderer.invoke('read-file', data),
    saveFile: (data: { projectId: string; relativePath: string; content: string }) => ipcRenderer.invoke('save-file', data),
    getStorageStats: (data: { projectId: string }) => ipcRenderer.invoke('get-storage-stats', data)
});

// WS-3 (compile + preview). A sandboxed preload cannot require @latexllm/compile-service, so the channel
// names are copied here; they must match WS3_CHANNELS in packages/compile-service/src/ipc/compileIpc.ts.
contextBridge.exposeInMainWorld('ws3', {
    compile: (projectId: string) => ipcRenderer.invoke('ws3:compile', projectId),
    cancel: (projectId: string) => ipcRenderer.invoke('ws3:cancel', projectId),
    getLatestLog: (projectId: string) => ipcRenderer.invoke('ws3:getLatestLog', projectId),
    getPdf: (projectId: string) => ipcRenderer.invoke('ws3:getPdf', projectId),
    resolveLogClick: (projectId: string, entry: unknown) => ipcRenderer.invoke('ws3:resolveLogClick', projectId, entry),
    info: () => ipcRenderer.invoke('ws3:info'),
    projectOpened: (projectId: string) => ipcRenderer.send('ws3:projectOpened', projectId)
});
