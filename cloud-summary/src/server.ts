import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { app } from './app';
import { logger } from './config/logger';

dotenv.config();

const PORT = process.env.PORT || 3443;
const keyPath = path.join(__dirname, '../certs/server.key');
const certPath = path.join(__dirname, '../certs/server.cert');

let server: https.Server | http.Server;

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const httpsOptions: https.ServerOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: 'TLSv1.2'
  };

  server = https.createServer(httpsOptions, app).listen(PORT, () => {
    logger.info(`Project Server listening securely over HTTPS (TLS 1.2+) on port ${PORT}`);
  });
} else {
  server = http.createServer(app).listen(PORT, () => {
    logger.warn(`Certs not found; running HTTP fallback on port ${PORT}`);
  });
}

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
