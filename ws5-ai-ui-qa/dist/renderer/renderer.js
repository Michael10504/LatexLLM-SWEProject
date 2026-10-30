"use strict";
class AuthClient {
    baseUrl;
    constructor(baseUrl = 'http://localhost:3443') {
        this.baseUrl = baseUrl;
    }
    async register(username, password) {
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
        }
        catch {
            return { success: false, message: 'Server unreachable. Check backend connection.' };
        }
    }
    async login(username, password) {
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
        }
        catch {
            return { success: false, message: 'Server unreachable. Check backend connection.' };
        }
    }
    async logout(token) {
        try {
            await fetch(`${this.baseUrl}/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        }
        catch {
            // Local logout still completes if the backend is unavailable.
        }
    }
}
const authClient = new AuthClient();
let currentUser = null;
let isRegisterMode = false;
let hasUnsavedChanges = false; // Tracks modified document buffer status for UC-03
// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const userStatus = document.getElementById('user-status');
const logoutBtn = document.getElementById('logout-btn');
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
        if (!confirmLogout)
            return;
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
