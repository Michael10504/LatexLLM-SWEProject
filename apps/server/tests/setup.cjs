// Never run destructive database fixture cleanup against a developer's database.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const folder = path.resolve(__dirname, '../../../.cache/server-tests');
fs.mkdirSync(folder, { recursive: true });
process.env.NODE_ENV = 'test';
const database = path.join(folder, `test-${process.pid}.db`);
// The Windows Prisma schema engine needs the empty SQLite file to exist before
// its first migration; do not truncate an existing database.
fs.closeSync(fs.openSync(database, 'a'));
process.env.DATABASE_URL = `file:${database.split(path.sep).join('/')}`;
process.env.CLOUD_SUMMARY_STUB = '1';
process.env.CLOUD_SUMMARY_API_KEY = 'test-only-placeholder';
execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')],
    { env: process.env, stdio: 'pipe', timeout: 60000 });
