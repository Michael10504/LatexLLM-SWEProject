import fs from 'fs';
import path from 'path';

/**
 * CD-4a «entity» SettingsStore
 * Persists the global Local Only flag so it survives restarts (FR-06.1).
 */
export interface SettingsStore {
  persist(localOnly: boolean): void;
  load(): boolean;
}

interface SettingsFile {
  localOnly: boolean;
}

/**
 * Stores the setting in a small local JSON file, read before the login screen
 * appears (Design Spec 4.1, IF-06). Default when no file exists: Local Only OFF.
 * In Electron, pass app.getPath('userData') + '/settings.json'.
 */
export class FileSettingsStore implements SettingsStore {
  constructor(private readonly filePath: string) {}

  public load(): boolean {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SettingsFile>;
      return parsed.localOnly === true;
    } catch {
      // Missing or corrupt file -> fall back to the default.
      return false;
    }
  }

  public persist(localOnly: boolean): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    // Write-then-rename so a crash never leaves a half-written settings file.
    fs.writeFileSync(tmp, JSON.stringify({ localOnly } satisfies SettingsFile), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** In-memory store for tests and for the renderer before the file path is known. */
export class InMemorySettingsStore implements SettingsStore {
  constructor(private value = false) {}
  public load(): boolean {
    return this.value;
  }
  public persist(localOnly: boolean): void {
    this.value = localOnly;
  }
}
