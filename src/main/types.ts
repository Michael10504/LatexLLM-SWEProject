export interface Project {
    id: string;
    name: string;
    ownerId: string;
    role: 'OWNER' | 'EDITOR' | 'VIEWER';
    createdAt: string;
    updatedAt: string;
}

export interface ProjectFile {
    name: string;
    relativePath: string;
    sizeBytes: number;
    extension: string;
}

export interface StorageStats {
    fileCount: number;
    totalSizeBytes: number;
}