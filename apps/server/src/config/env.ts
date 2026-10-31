import dotenv from 'dotenv';
import path from 'node:path';
// Runs before repositories/controllers are constructed, for src and dist alike.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
