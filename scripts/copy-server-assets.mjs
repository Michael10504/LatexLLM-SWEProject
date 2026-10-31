import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist/data', { recursive: true });
copyFileSync('src/data/common-passwords.txt', 'dist/data/common-passwords.txt');
