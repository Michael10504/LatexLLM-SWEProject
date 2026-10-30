"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectRepository = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class ProjectRepository {
    db;
    constructor(dbPath) {
        this.db = new better_sqlite3_1.default(dbPath);
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        ownerId TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('OWNER', 'EDITOR', 'VIEWER')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
    }
    createProject(id, name, ownerId) {
        if (!name || name.trim().length === 0 || name.length > 100) {
            throw new Error('Project name must be between 1 and 100 characters.');
        }
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, ownerId, role, createdAt, updatedAt)
      VALUES (?, ?, ?, 'OWNER', ?, ?)
    `);
        try {
            stmt.run(id, name.trim(), ownerId, now, now);
            return { id, name: name.trim(), ownerId, role: 'OWNER', createdAt: now, updatedAt: now };
        }
        catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error(`A project named '${name}' already exists.`);
            }
            throw err;
        }
    }
    listOwnedProjects(ownerId) {
        const stmt = this.db.prepare('SELECT * FROM projects WHERE ownerId = ? ORDER BY updatedAt DESC');
        return stmt.all(ownerId);
    }
    deleteProject(id) {
        const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
        stmt.run(id);
    }
}
exports.ProjectRepository = ProjectRepository;
