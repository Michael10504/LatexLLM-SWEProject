import { EditorView, basicSetup } from 'codemirror';
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
interface AuthUser { username: string; token: string; }

class AuthClient {
    constructor(private readonly baseUrl = 'http://localhost:3443') { }
    async register(username: string, password: string): Promise<{ success: boolean; message?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json();
            return response.ok ? { success: true } : { success: false, message: data.message || 'Registration failed.' };
        } catch { return { success: false, message: 'Server unreachable. Check backend connection.' }; }
    }
    async login(username: string, password: string): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json();
            return response.ok ? { success: true, user: { username, token: data.token } } : { success: false, message: data.message || 'Invalid username or password.' };
        } catch { return { success: false, message: 'Server unreachable. Check backend connection.' }; }
    }
    async logout(token: string): Promise<void> {
        try { await fetch(`${this.baseUrl}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch { /* Local logout still completes. */ }
    }
}
const authClient = new AuthClient();
let currentUser: AuthUser | null = null;
let isRegisterMode = false;
let hasUnsavedChanges = false; // Tracks modified document buffer status for UC-03
let activeProjectId: string | null = null;
let activeEditor: EditorView | null = null;
const editorContainer = document.getElementById('editor-view') as HTMLDivElement;

// Project elements
const projectOverlay = document.getElementById('project-overlay') as HTMLDivElement;
const projectList = document.getElementById('project-list') as HTMLDivElement;
const newProjectNameInput = document.getElementById('new-project-name') as HTMLInputElement;
const createProjectBtn = document.getElementById('create-project-btn') as HTMLButtonElement;
const projectError = document.getElementById('project-error') as HTMLDivElement;



// DOM Elements
const authOverlay = document.getElementById('auth-overlay') as HTMLDivElement;
const authTitle = document.getElementById('auth-title') as HTMLHeadingElement;
const authError = document.getElementById('auth-error') as HTMLDivElement;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const passwordInput = document.getElementById('password-input') as HTMLInputElement;
const authSubmitBtn = document.getElementById('auth-submit-btn') as HTMLButtonElement;
const authToggleBtn = document.getElementById('auth-toggle-btn') as HTMLButtonElement;
const userStatus = document.getElementById('user-status') as HTMLSpanElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;

function enterApp(user: AuthUser): void {
    currentUser = user;
    authOverlay.style.display = 'none';
    projectOverlay.style.display = 'flex';
    renderProjectList();
    userStatus.innerText = `User: ${user.username}`;
    logoutBtn.style.display = 'inline-block';
}

authToggleBtn?.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    authTitle.innerText = isRegisterMode ? 'Register Account' : 'Login';
    authSubmitBtn.innerText = isRegisterMode ? 'Create Account' : 'Sign In';
    authToggleBtn.innerText = isRegisterMode ? 'Already have an account? Login' : 'Need an account? Register';
    authError.innerText = '';
});

authSubmitBtn?.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (username.length < 3 || username.length > 32) { authError.innerText = 'Username must be between 3 and 32 characters.'; return; }
    if (password.length < 8) { authError.innerText = 'Password must be at least 8 characters.'; return; }
    authError.innerText = 'Connecting...';
    if (isRegisterMode) {
        const result = await authClient.register(username, password);
        if (!result.success) { authError.innerText = result.message || 'Registration failed.'; return; }
        isRegisterMode = false;
    }
    const result = await authClient.login(username, password);
    if (!result.success || !result.user) { authError.innerText = result.message || 'Invalid username or password.'; return; }
    enterApp(result.user);
    passwordInput.value = '';
});

// Logout Handler with UC-03 Unsaved Changes Check
logoutBtn?.addEventListener('click', async () => {
    if (hasUnsavedChanges) {
        const confirmLogout = window.confirm('You have unsaved changes in your document. Are you sure you want to log out without saving?');
        if (!confirmLogout) return;
    }

    if (currentUser?.token) {
        await authClient.logout(currentUser.token);
    }

    currentUser = null;
    hasUnsavedChanges = false;
    userStatus.innerText = 'User: Not Logged In';
    logoutBtn.style.display = 'none';
    authOverlay.style.display = 'flex';
    activeProjectId = null;
    activeEditor?.destroy();
    activeEditor = null;
    editorContainer.innerHTML = '';
    projectOverlay.style.display = 'none';
});

//Project Handling
async function renderProjectList() {
    if (!currentUser) return;

    projectList.innerHTML = '<div class="empty-state">Loading...</div>';
    const projects = await window.electronAPI.listProjects({ ownerId: currentUser.username });

    if (projects.length === 0) {
        projectList.innerHTML = '<div class="empty-state">No projects found. Create one below.</div>';
        return;
    }

    projectList.innerHTML = '';
    projects.forEach(proj => {
        const item = document.createElement('div');
        item.className = 'project-item';

        // Info section (Click to open)
        const info = document.createElement('div');
        info.className = 'project-info';
        info.innerHTML = `
      <span class="project-name">${proj.name}</span>
      <span class="project-meta">Role: ${proj.role} | Last updated: ${new Date(proj.updatedAt).toLocaleDateString()}</span>
    `;
        info.addEventListener('click', () => openProject(proj.id, proj.name, proj.role));

        // Actions section (Delete button)
        const actions = document.createElement('div');
        actions.className = 'project-actions';
        const deleteBtn = document.createElement('button');
        deleteBtn.innerText = 'Delete';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent opening the project when clicking delete
            const confirmDelete = window.confirm(`Permanently delete project '${proj.name}'? This cannot be undone.`);
            if (confirmDelete) {
                await window.electronAPI.deleteProject({ id: proj.id });
                renderProjectList(); // Refresh list
            }
        });
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);
        projectList.appendChild(item);
    });
}


async function openProject(id: string, name: string, role: string) {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    activeProjectId = id;
    projectOverlay.style.display = 'none';

    // Update status bar
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
        statusBar.firstElementChild!.innerHTML = `User: ${currentUser?.username} | Project: <strong>${name}</strong> | Role: ${role}`;
    }

    try {
        const mainTexContent = await window.electronAPI.readFile({ projectId: id, relativePath: 'main.tex' });
        initEditor(mainTexContent);
    } catch (error) {
        console.error('Failed to open main.tex:', error);
        initEditor('% Error loading main.tex');
    }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY_MS = 1500;

const autoSaveExtension = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    hasUnsavedChanges = true;
    let indicator = document.getElementById('saving-indicator');
    if (!indicator) {
        indicator = document.createElement('span');
        indicator.id = 'saving-indicator';
        indicator.style.cssText = 'color:#f1c40f;margin-left:12px;font-style:italic;';
        document.getElementById('status-bar')?.firstElementChild?.appendChild(indicator);
    }
    indicator.textContent = '*Unsaved';
    indicator.style.color = '#f1c40f';

    if (saveTimeout) clearTimeout(saveTimeout);
    const projectIdToSave = activeProjectId;
    saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        if (!projectIdToSave) return;

        const content = update.state.doc.toString();
        const savingIndicator = document.getElementById('saving-indicator');
        if (savingIndicator) {
            savingIndicator.textContent = 'Saving...';
            savingIndicator.style.color = '#3498db';
        }

        try {
            await window.electronAPI.saveFile({ projectId: projectIdToSave, relativePath: 'main.tex', content });
            hasUnsavedChanges = false;
            savingIndicator?.remove();
        } catch (error) {
            console.error('Auto-save failed:', error);
            const failedIndicator = document.getElementById('saving-indicator');
            if (failedIndicator) {
                failedIndicator.textContent = 'Save Failed!';
                failedIndicator.style.color = '#e74c3c';
            }
        }
    }, AUTO_SAVE_DELAY_MS);
});

function initEditor(content: string): void {
    activeEditor?.destroy();
    editorContainer.innerHTML = '';
    activeEditor = new EditorView({
        doc: content,
        extensions: [
            basicSetup,
            // The legacy mode's parser is runtime-compatible; the cast bridges the
            // duplicate StreamParser type identities reported by this TypeScript setup.
            StreamLanguage.define(stex as unknown as StreamParser<unknown>), // LaTeX syntax highlighting
            autoSaveExtension // Auto-save listener
        ],
        parent: editorContainer
    });
}

createProjectBtn?.addEventListener('click', async () => {
    const name = newProjectNameInput.value.trim();
    if (name.length < 1 || name.length > 100) {
        projectError.innerText = 'Name must be between 1 and 100 characters.';
        return;
    }
    if (!currentUser) return;

    try {
        projectError.innerText = 'Creating...';
        await window.electronAPI.createProject({ name, ownerId: currentUser.username });
        newProjectNameInput.value = '';
        projectError.innerText = '';
        renderProjectList();
    } catch (error: any) {
        projectError.innerText = error.message;
    }
});


// Existing IPC Test
document.getElementById('ping-btn')?.addEventListener('click', async () => {
    const responseElement = document.getElementById('ping-response');
    if (responseElement) {
        responseElement.innerText = await window.electronAPI.ping();
    }
});
