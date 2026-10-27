import express from 'express';
import cors from 'cors';
import { httpLogger } from './config/logger';
import { authController } from './controllers/AuthController';
import { requireAuth, AuthenticatedRequest } from './middleware/authMiddleware';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(httpLogger);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', tlsMinVersion: 'TLSv1.2' });
});

// Auth routes (IF-01: UC-01, UC-02, UC-03)
app.post('/register', (req, res) => authController.register(req, res));
app.post('/login', (req, res) => authController.login(req, res));
app.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => authController.logout(req, res));
