import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
dotenv.config({ path: path.join(root, 'apps/server/.env') });
const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
if (!databaseUrl.startsWith('file:')) throw new Error('This application uses the supplied SQLite schema.');
let filename = databaseUrl.slice(5).split('?')[0];
if (databaseUrl.startsWith('file://')) filename = fileURLToPath(databaseUrl);
const database = path.isAbsolute(filename) ? filename : path.resolve(root, 'apps/server/prisma', filename);
mkdirSync(path.dirname(database), { recursive: true });
if (!existsSync(database)) closeSync(openSync(database, 'wx'));
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy',
    '--schema', path.join(root, 'apps/server/prisma/schema.prisma')], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
