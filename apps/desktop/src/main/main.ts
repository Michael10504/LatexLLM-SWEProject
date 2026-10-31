import { app, BrowserWindow, ipcMain, session } from 'electron';
import * as path from 'path';
import { FileStore } from './FileStore';
import { ProjectRepository } from './ProjectRepository';
import { registerWs3 } from './ws3';
import { registerIntegration } from './integration';
import { randomUUID } from 'node:crypto';

let fileStore: FileStore;
let projectRepo: ProjectRepository;
let window: BrowserWindow | undefined;
// Keep the original application's data directory after adopting a scoped npm name.
app.setName('latex-llm-editor');
delete process.env.CLOUD_SUMMARY_API_KEY;
delete process.env.CREDENTIAL_MASTER_SECRET;
if (process.env.LTX_USER_DATA) app.setPath('userData', path.resolve(process.env.LTX_USER_DATA));

function createWindow() {
    const mainWindow = new BrowserWindow({
        show: process.env.LTX_HEADLESS !== '1',
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    window = mainWindow;
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.on('closed', () => { window = undefined; });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
    // Every network operation belongs to the guarded main-process gateway.
    // PDF workers and UI assets are local files, so renderers need no HTTP exit.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, callback) => callback({ cancel: true }));
    const userDataPath = app.getPath('userData');
    fileStore = new FileStore(path.join(userDataPath, 'projects_data'));
    projectRepo = new ProjectRepository(path.join(userDataPath, 'app_metadata.db'));
    const integration = registerIntegration(ipcMain, { userData: userDataPath,
        root: path.resolve(__dirname, '../../../..'), projects: projectRepo, window: () => window });
    app.on('before-quit', () => { void integration.stop(); });

    // Ping Test Handler
    ipcMain.handle('ping-main', () => 'Pong from the Main Process!');

    // Storage IPC Handlers
    ipcMain.handle('create-project', (_event, { name, ownerId }) => {
        const username = integration.requireUser();
        if (typeof name !== 'string') throw new Error('Invalid project name.');
        const id = `proj_${randomUUID()}`;
        const project = projectRepo.createProject(id, name, username);
        fileStore.initProjectDirectory(id);
        return project;
    });

    ipcMain.handle('list-projects', (_event, { ownerId }) => {
        return projectRepo.listOwnedProjects(integration.requireUser());
    });

    ipcMain.handle('delete-project', (_event, { id }) => {
        integration.project(id, false, true);
        projectRepo.deleteProject(id);
        fileStore.deleteProjectFiles(id);
        return { success: true };
    });

    ipcMain.handle('read-file', (_event, { projectId, relativePath }) => {
        integration.project(projectId);
        return fileStore.readFile(projectId, relativePath);
    });

    ipcMain.handle('save-file', (_event, { projectId, relativePath, content }) => {
        integration.project(projectId, true);
        if (typeof content !== 'string') throw new Error('Invalid document content.');
        fileStore.saveFile(projectId, relativePath, content);
        return { success: true };
    });

    ipcMain.handle('get-storage-stats', (_event, { projectId }) => {
        integration.project(projectId);
        return fileStore.calculateStats(projectId);
    });

    // WS-3: sandboxed compilation + PDF preview (IF-03). The renderer only sends a project id;
    // the folder is looked up here from the project registry.
    registerWs3(ipcMain, {
        cacheDir: path.join(userDataPath, 'compile-cache'),
        resolveProject: (id) => {
            try { integration.project(id); return { id, rootDir: fileStore.getProjectPath(id) }; }
            catch { return undefined; }
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
