interface AuthUser {
    username: string;
    token: string;
}

class AuthClient {
    constructor(private readonly baseUrl = 'http://localhost:3443') {}

    public async register(username: string, password: string): Promise<{ success: boolean; message?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) {
                return { success: false, message: data.message || 'Registration failed.' };
            }
            return { success: true };
        } catch {
            return { success: false, message: 'Server unreachable. Check backend connection.' };
        }
    }

    public async login(username: string, password: string): Promise<{ success: boolean; user?: AuthUser; message?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) {
                return { success: false, message: data.message || 'Invalid username or password.' };
            }
            return { success: true, user: { username, token: data.token } };
        } catch {
            return { success: false, message: 'Server unreachable. Check backend connection.' };
        }
    }

    public async logout(token: string): Promise<void> {
        try {
            await fetch(`${this.baseUrl}/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch {
            // Local logout still completes if the backend is unavailable.
        }
    }
}

const authClient = new AuthClient();
let currentUser: AuthUser | null = null;
let isRegisterMode = false;
let hasUnsavedChanges = false; // Tracks modified document buffer status for UC-03

// DOM Elements
const authOverlay = document.getElementById('auth-overlay') as HTMLDivElement;
const authTitle = document.getElementById('auth-title') as HTMLHeadingElement;
const authError = document.getElementById('auth-error') as HTMLDivElement;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const passwordInput = document.getElementById('password-input') as HTMLInputElement;
const authSubmitBtn = document.getElementById('auth-submit-btn') as HTMLButtonElement;
const authToggleBtn = document.getElementById('auth-toggle-btn') as HTMLDivElement;
const userStatus = document.getElementById('user-status') as HTMLSpanElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;

// Mode Toggle
authToggleBtn?.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    authTitle.innerText = isRegisterMode ? 'Register Account' : 'Login';
    authSubmitBtn.innerText = isRegisterMode ? 'Create Account' : 'Sign In';
    authToggleBtn.innerText = isRegisterMode ? 'Already have an account? Login' : 'Need an account? Register';
    authError.innerText = '';
});

// Submit Authentication
authSubmitBtn?.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (username.length < 3 || username.length > 32) {
        authError.innerText = 'Username must be between 3 and 32 characters.';
        return;
    }
    if (password.length < 8) {
        authError.innerText = 'Password must be at least 8 characters.';
        return;
    }

    authError.innerText = 'Connecting...';

    if (isRegisterMode) {
        const regResult = await authClient.register(username, password);
        if (!regResult.success) {
            authError.innerText = regResult.message || 'Registration failed.';
            return;
        }
        // Auto-login after registration
        isRegisterMode = false;
    }

    const loginResult = await authClient.login(username, password);
    if (!loginResult.success || !loginResult.user) {
        authError.innerText = loginResult.message || 'Invalid username or password.';
        return;
    }

    // Success State
    currentUser = loginResult.user;
    authOverlay.style.display = 'none';
    userStatus.innerText = `User: ${currentUser.username}`;
    logoutBtn.style.display = 'inline-block';
    passwordInput.value = '';
});

// Logout Handler with UC-03 Unsaved Changes Check
logoutBtn?.addEventListener('click', async () => {
    if (hasUnsavedChanges) {
        const confirmLogout = window.confirm('You have unsaved changes in your document. Are you sure you want to log out without saving?');
        if (!confirmLogout) return;
    }

    if (currentUser) {
        await authClient.logout(currentUser.token);
    }

    currentUser = null;
    hasUnsavedChanges = false;
    userStatus.innerText = 'User: Not Logged In';
    logoutBtn.style.display = 'none';
    authOverlay.style.display = 'flex';
});

// Existing IPC Test
document.getElementById('ping-btn')?.addEventListener('click', async () => {
    const responseElement = document.getElementById('ping-response');
    if (responseElement) {
        responseElement.innerText = await window.electronAPI.ping();
    }
});