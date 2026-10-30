"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class FileStore {
    baseDir;
    ALLOWED_EXTENSIONS = new Set(['.tex', '.bib', '.sty', '.png', '.jpg', '.pdf']);
    MAX_FILES = 500;
    MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
    constructor(baseDir) {
        this.baseDir = baseDir;
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }
    getProjectPath(projectId) {
        return path.join(this.baseDir, projectId);
    }
    initProjectDirectory(projectId) {
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
    calculateStats(projectId) {
        const projectPath = this.getProjectPath(projectId);
        if (!fs.existsSync(projectPath))
            return { fileCount: 0, totalSizeBytes: 0 };
        let fileCount = 0;
        let totalSizeBytes = 0;
        const traverse = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    traverse(fullPath);
                }
                else if (entry.isFile()) {
                    fileCount++;
                    const stats = fs.statSync(fullPath);
                    totalSizeBytes += stats.size;
                }
            }
        };
        traverse(projectPath);
        return { fileCount, totalSizeBytes };
    }
    validateNewFile(projectId, fileName, incomingSizeBytes) {
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
    saveFile(projectId, relativePath, content) {
        const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length;
        const filePath = path.join(this.getProjectPath(projectId), relativePath);
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
    readFile(projectId, relativePath) {
        const filePath = path.join(this.getProjectPath(projectId), relativePath);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${relativePath}`);
        }
        return fs.readFileSync(filePath, 'utf-8');
    }
    deleteProjectFiles(projectId) {
        const projectPath = this.getProjectPath(projectId);
        if (fs.existsSync(projectPath)) {
            fs.rmSync(projectPath, { recursive: true, force: true });
        }
    }
}
exports.FileStore = FileStore;
