import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { FileStore } from './FileStore';
import { ProjectRepository } from './ProjectRepository';

let fileStore: FileStore;
let projectRepo: ProjectRepository;

function createWindow() {
    const mainWindow = new BrowserWindow({
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

app.whenReady().then(() => {
    const userDataPath = app.getPath('userData');
    fileStore = new FileStore(path.join(userDataPath, 'projects_data'));
    projectRepo = new ProjectRepository(path.join(userDataPath, 'app_metadata.db'));

    // Ping Test Handler
    ipcMain.handle('ping-main', () => 'Pong from the Main Process!');

    // Storage IPC Handlers
    ipcMain.handle('create-project', (_event, { name, ownerId }) => {
        const id = `proj_${Date.now()}`;
        const project = projectRepo.createProject(id, name, ownerId);
        fileStore.initProjectDirectory(id);
        return project;
    });

    ipcMain.handle('list-projects', (_event, { ownerId }) => {
        return projectRepo.listOwnedProjects(ownerId);
    });

    ipcMain.handle('delete-project', (_event, { id }) => {
        projectRepo.deleteProject(id);
        fileStore.deleteProjectFiles(id);
        return { success: true };
    });

    ipcMain.handle('read-file', (_event, { projectId, relativePath }) => {
        return fileStore.readFile(projectId, relativePath);
    });

    ipcMain.handle('save-file', (_event, { projectId, relativePath, content }) => {
        fileStore.saveFile(projectId, relativePath, content);
        return { success: true };
    });

    ipcMain.handle('get-storage-stats', (_event, { projectId }) => {
        return fileStore.calculateStats(projectId);
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});