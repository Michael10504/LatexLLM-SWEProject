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