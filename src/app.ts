import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { httpLogger } from './config/logger';
import { authController } from './controllers/AuthController';
import { repositoryController } from './controllers/RepositoryController';
import { summarizationController } from './controllers/SummarizationController';
import { requireAuth, AuthenticatedRequest } from './middleware/authMiddleware';

export const app = express();

// Strictly in-memory storage so uploaded PDFs are NEVER written to server disk (FR-05.8)
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // Allows SummarizationController to return custom 400 on > 20 MB
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
