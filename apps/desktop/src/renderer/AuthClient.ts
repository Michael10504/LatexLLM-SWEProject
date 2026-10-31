import type { AuthUser } from '../shared/integration';
export type { AuthUser } from '../shared/integration';
export class AuthClient {
    register(username: string, password: string) { return window.integration.auth.register(username,password); }
    login(username: string, password: string): Promise<{success: boolean; user?: AuthUser; message?: string}> {
        return window.integration.auth.login(username,password);
    }
    logout() { return window.integration.auth.logout(); }
}
