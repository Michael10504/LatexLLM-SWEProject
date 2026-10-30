"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const FileStore_1 = require("./FileStore");
const ProjectRepository_1 = require("./ProjectRepository");
let fileStore;
let projectRepo;
function createWindow() {
    const mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}
electron_1.app.whenReady().then(() => {
    const userDataPath = electron_1.app.getPath('userData');
    fileStore = new FileStore_1.FileStore(path.join(userDataPath, 'projects_data'));
    projectRepo = new ProjectRepository_1.ProjectRepository(path.join(userDataPath, 'app_metadata.db'));
    // Ping Test Handler
    electron_1.ipcMain.handle('ping-main', () => 'Pong from the Main Process!');
    // Storage IPC Handlers
    electron_1.ipcMain.handle('create-project', (_event, { name, ownerId }) => {
        const id = `proj_${Date.now()}`;
        const project = projectRepo.createProject(id, name, ownerId);
        fileStore.initProjectDirectory(id);
        return project;
    });
    electron_1.ipcMain.handle('list-projects', (_event, { ownerId }) => {
        return projectRepo.listOwnedProjects(ownerId);
    });
    electron_1.ipcMain.handle('delete-project', (_event, { id }) => {
        projectRepo.deleteProject(id);
        fileStore.deleteProjectFiles(id);
        return { success: true };
    });
    electron_1.ipcMain.handle('read-file', (_event, { projectId, relativePath }) => {
        return fileStore.readFile(projectId, relativePath);
    });
    electron_1.ipcMain.handle('save-file', (_event, { projectId, relativePath, content }) => {
        fileStore.saveFile(projectId, relativePath, content);
        return { success: true };
    });
    electron_1.ipcMain.handle('get-storage-stats', (_event, { projectId }) => {
        return fileStore.calculateStats(projectId);
    });
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
