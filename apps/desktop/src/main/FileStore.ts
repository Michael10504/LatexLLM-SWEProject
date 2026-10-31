import * as fs from 'fs';
import * as path from 'path';
import { ProjectFile, StorageStats } from './types';

export class FileStore {
    private baseDir: string;
    private readonly ALLOWED_EXTENSIONS = new Set(['.tex', '.bib', '.sty', '.png', '.jpg', '.pdf']);
    private readonly MAX_FILES = 500;
    private readonly MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

    constructor(baseDir: string) {
        this.baseDir = baseDir;
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    public getProjectPath(projectId: string): string {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(projectId)) {
            throw new Error('Invalid project identifier.');
        }
        return path.join(this.baseDir, projectId);
    }

    private resolveFile(projectId: string, relativePath: string): string {
        if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw new Error('Invalid file path.');
        const root = path.resolve(this.getProjectPath(projectId));
        if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('Symbolic project roots are not allowed.');
        const target = path.resolve(root, relativePath);
        const relative = path.relative(root, target);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path outside project.');
        let current = root;
        for (const part of relative.split(path.sep)) {
            current = path.join(current, part);
            if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed in project files.');
        }
        return target;
    }

    public initProjectDirectory(projectId: string): string {
        const projectPath = this.getProjectPath(projectId);
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }
        // Create default main.tex (FR-01.1)
        const mainTexPath = path.join(projectPath, 'main.tex');
        if (!fs.existsSync(mainTexPath)) {
            const initialContent = `% Main LaTeX Document\n\\documentclass{article}\n\\begin{document}\nWelcome to your project!\n\\end{document}`;
            fs.writeFileSync(mainTexPath, initialContent, 'utf-8');
        }
        return projectPath;
    }

    public calculateStats(projectId: string): StorageStats {
        const projectPath = this.getProjectPath(projectId);
        if (!fs.existsSync(projectPath)) return { fileCount: 0, totalSizeBytes: 0 };

        let fileCount = 0;
        let totalSizeBytes = 0;

        const traverse = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    traverse(fullPath);
                } else if (entry.isFile()) {
                    fileCount++;
                    const stats = fs.statSync(fullPath);
                    totalSizeBytes += stats.size;
                }
            }
        };

        traverse(projectPath);
        return { fileCount, totalSizeBytes };
    }

    public validateNewFile(projectId: string, fileName: string, incomingSizeBytes: number): void {
        const ext = path.extname(fileName).toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.has(ext)) {
            throw new Error(`Invalid file extension '${ext}'. Allowed: .tex, .bib, .sty, .png, .jpg, .pdf`);
        }

        const currentStats = this.calculateStats(projectId);
        if (currentStats.fileCount >= this.MAX_FILES) {
            throw new Error(`Project file count limit reached (${this.MAX_FILES} files max).`);
        }

        if (currentStats.totalSizeBytes + incomingSizeBytes > this.MAX_SIZE_BYTES) {
            throw new Error(`Project storage limit exceeded (100 MB max).`);
        }
    }

    public saveFile(projectId: string, relativePath: string, content: string | Buffer): void {
        const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length;
        const filePath = this.resolveFile(projectId, relativePath);
        const ext = path.extname(relativePath).toLowerCase();
        if (!this.ALLOWED_EXTENSIONS.has(ext)) throw new Error('Unsupported project file type.');
        const previousSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        if (this.calculateStats(projectId).totalSizeBytes - previousSize + bytes > this.MAX_SIZE_BYTES) throw new Error('Project storage limit exceeded (100 MB max).');

        // Validate if creating a new file
        if (!fs.existsSync(filePath)) {
            this.validateNewFile(projectId, path.basename(relativePath), bytes);
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content);
    }

    public readFile(projectId: string, relativePath: string): string {
        const filePath = this.resolveFile(projectId, relativePath);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${relativePath}`);
        }
        return fs.readFileSync(filePath, 'utf-8');
    }

    public deleteProjectFiles(projectId: string): void {
        const projectPath = this.getProjectPath(projectId);
        if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    }
}
