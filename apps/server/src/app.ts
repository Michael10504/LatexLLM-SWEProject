import './config/env';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { httpLogger } from './config/logger';
import { authController } from './controllers/AuthController';
import { repositoryController } from './controllers/RepositoryController';
import { summarizationController } from './controllers/SummarizationController';
import { requireAuth, AuthenticatedRequest } from './middleware/authMiddleware';

import { publicSettings, saveSettings, deleteSettings } from './repositories/AccountCloudSettings';

export const app = express();

// Strictly in-memory storage so uploaded PDFs are NEVER written to server disk (FR-05.8)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(httpLogger);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', tlsMinVersion: 'TLSv1.2' });
});

// 1. Auth routes (IF-01: UC-01, UC-02, UC-03)
app.post('/register', (req, res) => authController.register(req, res));
app.post('/login', (req, res) => authController.login(req, res));
app.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => authController.logout(req, res));

// Settings are always scoped to the authenticated account, never a supplied username.
app.get('/account/cloud', requireAuth, async (req: AuthenticatedRequest, res) => {
  try { res.json(await publicSettings(req.user!.username)); }
  catch { res.status(500).json({ error: 'Could not read cloud settings.' }); }
});
app.post('/account/cloud', requireAuth, async (req: AuthenticatedRequest, res) => {
  try { res.json(await saveSettings(req.user!.username, req.body)); }
  catch { res.status(400).json({ error: 'Could not save settings. Check provider, HTTPS endpoint/model and API key.' }); }
});
app.post('/account/cloud/delete', requireAuth, async (req: AuthenticatedRequest, res) => {
  try { await deleteSettings(req.user!.username); res.json({ configured: false }); }
  catch { res.status(500).json({ error: 'Could not remove cloud settings.' }); }
});

// 2. Project & Role Enforcement routes (IF-02: FR-01.1 to FR-01.6)
app.get('/projects', requireAuth, (req: AuthenticatedRequest, res) =>
  repositoryController.listProjects(req, res)
);
app.post('/projects', requireAuth, (req: AuthenticatedRequest, res) =>
  repositoryController.createProject(req, res)
);
app.put('/projects/:id/files', requireAuth, (req: AuthenticatedRequest, res) =>
  repositoryController.updateProjectFiles(req, res)
);
app.delete('/projects/:id', requireAuth, (req: AuthenticatedRequest, res) =>
  repositoryController.deleteProject(req, res)
);

// 3. Stateless Cloud PDF Summarization Relay (IF-07: FR-05.1, FR-05.4, FR-05.6, FR-05.8)
app.post(
  '/summarize',
  requireAuth,
  uploadMemory.single('pdf'),
  (req: AuthenticatedRequest, res) => summarizationController.summarize(req, res)
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds the maximum allowed size of 20 MB.' : 'Invalid PDF upload.' });
    return;
  }
  res.status(500).json({ error: 'The request could not be completed.' });
});
