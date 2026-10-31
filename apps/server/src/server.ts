import './config/env';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { app } from './app';
import { logger } from './config/logger';

dotenv.config();

const PORT = process.env.PORT || 3443;
const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, '../certs/server.key');
const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, '../certs/server.cert');
const HOST = process.env.HOST || '127.0.0.1';

let server: https.Server | http.Server;

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const httpsOptions: https.ServerOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: 'TLSv1.2'
  };

  server = https.createServer(httpsOptions, app).listen(Number(PORT), HOST, () => {
    logger.info(`Project Server listening securely over HTTPS (TLS 1.2+) on port ${PORT}`);
  });
} else {
  if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
    throw new Error('TLS certificates are required before binding the server to a non-loopback interface.');
  }
  server = http.createServer(app).listen(Number(PORT), HOST, () => {
    logger.warn(`Certs not found; running HTTP fallback on port ${PORT}`);
  });
}

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
