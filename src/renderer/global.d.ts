import type { Ws3Api } from '@latexllm/compile-service';

export {};

declare global {
    interface Project {
        id: string;
        name: string;
        ownerId: string;
        role: 'OWNER' | 'EDITOR' | 'VIEWER';
        createdAt: string;
        updatedAt: string;
    }

    interface StorageStats {
        fileCount: number;
        totalSizeBytes: number;
    }

    interface Window {
        electronAPI: {
            ping: () => Promise<string>;
            createProject: (data: {
                name: string;
                ownerId: string;
            }) => Promise<Project>;
            listProjects: (data: {
                ownerId: string;
            }) => Promise<Project[]>;
            deleteProject: (data: {
                id: string;
            }) => Promise<{ success: boolean }>;
            readFile: (data: {
                projectId: string;
                relativePath: string;
            }) => Promise<string>;
            saveFile: (data: {
                projectId: string;
                relativePath: string;
                content: string;
            }) => Promise<{ success: boolean }>;
            getStorageStats: (data: {
                projectId: string;
            }) => Promise<StorageStats>;
        };
        /** WS-3 compile + preview bridge (see src/preload/preload.ts). */
        ws3: Ws3Api & {
            info: () => Promise<{ stub: boolean; dev: boolean }>;
            projectOpened: (projectId: string) => void;
        };
    }
}
