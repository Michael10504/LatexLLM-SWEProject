"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    ping: () => electron_1.ipcRenderer.invoke('ping-main'),
    createProject: (data) => electron_1.ipcRenderer.invoke('create-project', data),
    listProjects: (data) => electron_1.ipcRenderer.invoke('list-projects', data),
    deleteProject: (data) => electron_1.ipcRenderer.invoke('delete-project', data),
    readFile: (data) => electron_1.ipcRenderer.invoke('read-file', data),
    saveFile: (data) => electron_1.ipcRenderer.invoke('save-file', data),
    getStorageStats: (data) => electron_1.ipcRenderer.invoke('get-storage-stats', data)
});
