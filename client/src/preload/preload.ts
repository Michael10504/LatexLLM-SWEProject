import { contextBridge, ipcRenderer } from 'electron';

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
