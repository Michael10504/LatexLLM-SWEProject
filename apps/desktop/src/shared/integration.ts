export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';
export type LocalTask = 'notes' | 'outline' | 'clarity' | 'tone' | 'grammar';
export interface AiRequest { id: string; projectId: string; task: LocalTask; text: string; }
export interface AiEvent { id: string; event: 'token' | 'status'; text?: string; status?: string; }
export interface AiResult { text: string; stub: boolean; }
export interface AuthUser { username: string; }
export interface IntegrationApi {
    auth: {
        register(username: string, password: string): Promise<{ success: boolean; message?: string }>;
        login(username: string, password: string): Promise<{ success: boolean; user?: AuthUser; message?: string }>;
        logout(): Promise<void>;
        devLogin(): Promise<AuthUser>;
        restore(): Promise<AuthUser | null>;
    };
    privacy: {
        get(): Promise<{ localOnly: boolean }>;
        set(localOnly: boolean): Promise<{ localOnly: boolean }>;
    };
    localAI: {
        run(request: AiRequest): Promise<AiResult>;
        cancel(id: string): Promise<{ stopped: boolean }>;
        onEvent(callback: (event: AiEvent) => void): () => void;
        info(): Promise<{ stub: boolean; tasks: LocalTask[] }>;
    };
    cloud: {
        settings(): Promise<{ configured: boolean; provider: string; endpoint: string; model: string; demo: boolean }>;
        saveSettings(value: { provider: string; endpoint: string; model: string; apiKey: string }): Promise<unknown>;
        deleteSettings(): Promise<unknown>;
        summarize(): Promise<{ status: string }>;
        onEvent(callback: (event: { kind: string; message?: string; fileName?: string; summary?: string }) => void): () => void;
    };
}
