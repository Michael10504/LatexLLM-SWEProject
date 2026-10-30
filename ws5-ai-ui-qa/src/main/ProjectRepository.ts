import Database from 'better-sqlite3';
import { Project } from './types';

export class ProjectRepository {
    private db: Database.Database;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.initSchema();
    }

    private initSchema(): void {
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

    public createProject(id: string, name: string, ownerId: string): Project {
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
        } catch (err: any) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error(`A project named '${name}' already exists.`);
            }
            throw err;
        }
    }

    public listOwnedProjects(ownerId: string): Project[] {
        const stmt = this.db.prepare('SELECT * FROM projects WHERE ownerId = ? ORDER BY updatedAt DESC');
        return stmt.all(ownerId) as Project[];
    }

    public deleteProject(id: string): void {
        const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
        stmt.run(id);
    }
}