export interface AuthUser {
    username: string;
    token: string;
}

export class AuthClient {
    private baseUrl: string;

    constructor(baseUrl = 'http://localhost:3443') {
        this.baseUrl = baseUrl;
    }

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
                // Enforce generic 401 message or 423 locked account message
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
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch {
            // Session local cleanup proceeds regardless of network status
        }
    }
}