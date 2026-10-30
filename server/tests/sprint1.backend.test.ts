import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { Role } from '@prisma/client';
import { app } from '../src/app';
import { prisma } from '../src/config/db';
import { sessionStore } from '../src/repositories/SessionStore';
import { userRepository } from '../src/repositories/UserRepository';
import { credentialStore } from '../src/repositories/CredentialStore';
import { summarizationController } from '../src/controllers/SummarizationController';

describe('Milestone 2 - Sprint 1 Formal Backend Test Suite (WS-1: Member 1)', () => {
  beforeEach(async () => {
    // Clean database tables before each formal test for complete isolation
    await prisma.projectMembership.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    summarizationController.resetCloudProviderFn();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. IF-01: REGISTRATION & PASSWORD POLICY (FR-07.1, FR-07.2, UC-01)
  // Methodology: Boundary Value Analysis (BVA), Equivalence Partitioning (EP), Inspection (I)
  // =========================================================================
  describe('IF-01: Registration & Password Policy (FR-07.1, FR-07.2)', () => {
    test('TC-01.1 [BVA - FR-07.1]: Username length boundaries (2, 3, 32, 33 chars)', async () => {
      // Lower invalid boundary: 2 chars -> 400
      const res2 = await request(app)
        .post('/register')
        .send({ username: 'ab', password: 'Valid!Password2026' });
      expect(res2.status).toBe(400);

      // Lower valid boundary: 3 chars -> 201
      const res3 = await request(app)
        .post('/register')
        .send({ username: 'abc', password: 'Valid!Password2026' });
      expect(res3.status).toBe(201);

      // Upper valid boundary: 32 chars -> 201
      const res32 = await request(app)
        .post('/register')
        .send({ username: 'u'.repeat(32), password: 'Valid!Password2026' });
      expect(res32.status).toBe(201);

      // Upper invalid boundary: 33 chars -> 400
      const res33 = await request(app)
        .post('/register')
        .send({ username: 'u'.repeat(33), password: 'Valid!Password2026' });
      expect(res33.status).toBe(400);
    });

    test('TC-01.2 [EP - FR-07.1]: Reject duplicate username registration (UC-01 2a)', async () => {
      await request(app)
        .post('/register')
        .send({ username: 'omar_auc', password: 'Valid!Password2026' })
        .expect(201);

      const dupRes = await request(app)
        .post('/register')
        .send({ username: 'omar_auc', password: 'Another!Password2026' });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.violatedRule).toMatch(/already registered/i);
    });

    test('TC-01.3 [BVA & EP - FR-07.2]: Password length (7, 8, 64, 65) and 10k common-password list rejection', async () => {
      // 7 chars (Invalid BVA) -> 400
      const shortRes = await request(app)
        .post('/register')
        .send({ username: 'user_short', password: '1234567' });
      expect(shortRes.status).toBe(400);

      // 8 chars (Valid min BVA) -> 201
      const minRes = await request(app)
        .post('/register')
        .send({ username: 'user_min8', password: 'Val!d8Ch' });
      expect(minRes.status).toBe(201);

      // 64 chars (Valid max BVA) -> 201
      const maxRes = await request(app)
        .post('/register')
        .send({ username: 'user_max64', password: 'V'.repeat(63) + '!' });
      expect(maxRes.status).toBe(201);

      // 65 chars (Invalid max BVA) -> 400
      const overRes = await request(app)
        .post('/register')
        .send({ username: 'user_over65', password: 'V'.repeat(65) });
      expect(overRes.status).toBe(400);

      // Common password on 10,000 list (Invalid EP) -> 400
      const commonRes = await request(app)
        .post('/register')
        .send({ username: 'user_common', password: 'password123' });
      expect(commonRes.status).toBe(400);
      expect(commonRes.body.violatedRule).toMatch(/common-password list/i);
    });

    test('TC-01.4 [Inspection - FR-07.2]: Verify passwords are stored only as Argon2id salted hashes and registration starts no session', async () => {
      const regRes = await request(app)
        .post('/register')
        .send({ username: 'dr_laila', password: 'Unpublished!Research2026' });

      expect(regRes.status).toBe(201);
      expect(regRes.body.token).toBeUndefined(); // Registration must NOT start a session

      const dbUser = await userRepository.findByUsername('dr_laila');
      expect(dbUser).not.toBeNull();
      expect(dbUser!.passwordHash).not.toBe('Unpublished!Research2026');
      expect(dbUser!.passwordHash.startsWith('$argon2id$')).toBe(true);

      const activeSessions = await prisma.session.count({ where: { username: 'dr_laila' } });
      expect(activeSessions).toBe(0);
    });
  });

  // =========================================================================
  // 2. IF-01: LOGIN, LOCKOUT & SESSIONS (FR-07.3, FR-07.4, FR-07.5, UC-02, UC-03)
  // Methodology: Equivalence Partitioning (EP), State-Transition Testing, BVA
  // =========================================================================
  describe('IF-01: Authentication, 15-Min Lockout & 8-Hr Sessions (FR-07.3 - FR-07.5)', () => {
    beforeEach(async () => {
      await request(app)
        .post('/register')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
    });

    test('TC-01.5 [EP - FR-07.3]: Valid login starts session; wrong username and wrong password return identical generic message', async () => {
      const wrongUserRes = await request(app)
        .post('/login')
        .send({ username: 'non_existent_user', password: 'Str0ng!LatexPass2026' });

      const wrongPassRes = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'WrongPassword123!' });

      expect(wrongUserRes.status).toBe(401);
      expect(wrongPassRes.status).toBe(401);
      // Both must return the exact same generic message so username existence is not leaked
      expect(wrongUserRes.body.error).toBe(wrongPassRes.body.error);

      const validLogin = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
      expect(validLogin.status).toBe(200);
      expect(typeof validLogin.body.token).toBe('string');
    });

    test('TC-01.6 [State-Transition - FR-07.4]: 5 consecutive failed logins within 15m lock account for 15m (HTTP 423)', async () => {
      // Attempts 1 to 4 fail with 401
      for (let i = 1; i <= 4; i++) {
        const res = await request(app)
          .post('/login')
          .send({ username: 'mohamed_auc', password: 'BadPassword!' });
        expect(res.status).toBe(401);
      }

      // 5th consecutive failure within 15 minutes transitions account to LOCKED (423)
      const fifthRes = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'BadPassword!' });
      expect(fifthRes.status).toBe(423);
      expect(fifthRes.body.error).toMatch(/locked for 15 minutes/i);

      // Attempt 6 with CORRECT password while locked must STILL be rejected with 423
      const lockedValidAttempt = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
      expect(lockedValidAttempt.status).toBe(423);

      // Simulate 15 minutes + 1 second passing by moving lockedUntil into the past
      const pastLock = new Date(Date.now() - 1000);
      await userRepository.lock('mohamed_auc', pastLock);

      // Attempt 7 after 15m expiry succeeds with 200 OK
      const unlockedAttempt = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
      expect(unlockedAttempt.status).toBe(200);
    });

    test('TC-01.7 [BVA & State-Transition - FR-07.5]: Session expires after > 8 hours of inactivity or on explicit logout', async () => {
      const loginRes = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
      const token = loginRes.body.token;

      // 1. Simulate 7 hours 59 minutes of inactivity (Valid BVA <= 8h)
      const sevenHours59MinAgo = new Date(Date.now() - (8 * 60 * 60 * 1000 - 60 * 1000));
      await sessionStore.touch(token, sevenHours59MinAgo);

      const activeRes = await request(app)
        .get('/projects')
        .set('Authorization', `Bearer ${token}`);
      expect(activeRes.status).toBe(200);

      // 2. Simulate 8 hours + 1 minute of inactivity (Invalid BVA > 8h)
      const eightHours1MinAgo = new Date(Date.now() - (8 * 60 * 60 * 1000 + 60 * 1000));
      await sessionStore.touch(token, eightHours1MinAgo);

      const expiredRes = await request(app)
        .get('/projects')
        .set('Authorization', `Bearer ${token}`);
      expect(expiredRes.status).toBe(401);
      expect(expiredRes.body.error).toMatch(/expired after 8 hours/i);

      // 3. Test explicit logout invalidation (UC-03)
      const reloginRes = await request(app)
        .post('/login')
        .send({ username: 'mohamed_auc', password: 'Str0ng!LatexPass2026' });
      const newToken = reloginRes.body.token;

      await request(app)
        .post('/logout')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      await request(app)
        .get('/projects')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(401);
    });
  });

  // =========================================================================
  // 3. IF-02: PROJECT MANAGEMENT & SERVER ROLE ENFORCEMENT (FR-01.1, FR-01.4 - FR-01.6)
  // Methodology: BVA, Policy Fixture Testing (Owner, Editor, Viewer)
  // =========================================================================
  describe('IF-02: Project Creation & Server-Side Role Policy (FR-01.1, FR-01.4 - FR-01.6)', () => {
    let ownerToken: string;
    let editorToken: string;
    let viewerToken: string;

    beforeEach(async () => {
      await request(app).post('/register').send({ username: 'owner_u', password: 'Valid!Password2026' });
      await request(app).post('/register').send({ username: 'editor_u', password: 'Valid!Password2026' });
      await request(app).post('/register').send({ username: 'viewer_u', password: 'Valid!Password2026' });

      ownerToken = (await request(app).post('/login').send({ username: 'owner_u', password: 'Valid!Password2026' })).body.token;
      editorToken = (await request(app).post('/login').send({ username: 'editor_u', password: 'Valid!Password2026' })).body.token;
      viewerToken = (await request(app).post('/login').send({ username: 'viewer_u', password: 'Valid!Password2026' })).body.token;
    });

    test('TC-02.1 [BVA & EP - FR-01.1]: Project name length (0, 1, 100, 101) and uniqueness per user', async () => {
      // 0 chars (Invalid BVA) -> 400
      await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: '' })
        .expect(400);

      // 1 char (Valid min BVA) -> 201 with main.tex and OWNER role
      const minProj = await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'A' });
      expect(minProj.status).toBe(201);
      expect(minProj.body.mainFile).toBe('main.tex');
      expect(minProj.body.role).toBe(Role.OWNER);

      // Duplicate name for same user -> 400
      await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'A' })
        .expect(400);

      // 100 chars (Valid max BVA) -> 201
      await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'P'.repeat(100) })
        .expect(201);

      // 101 chars (Invalid max BVA) -> 400
      await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'P'.repeat(101) })
        .expect(400);
    });

    test('TC-02.2 [Policy Fixtures - FR-01.4, FR-01.5, FR-01.6]: Server enforces Owner, Editor, and Viewer permissions independently', async () => {
      // Create project as Owner
      const projRes = await request(app)
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Shared Research Paper' });
      const projectId = projRes.body.id;

      // Seed Editor and Viewer fixtures per Design Spec Section 3.2 Note 1
      await prisma.projectMembership.createMany({
        data: [
          { username: 'editor_u', projectId, role: Role.EDITOR },
          { username: 'viewer_u', projectId, role: Role.VIEWER }
        ]
      });

      // 1. Viewer attempts to edit/save project files -> Refused with 403 (FR-01.6)
      const viewerEdit = await request(app)
        .put(`/projects/${projectId}/files`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ content: 'modified' });
      expect(viewerEdit.status).toBe(403);

      // 2. Editor attempts to edit/save project files -> Allowed with 200 (FR-01.6)
      const editorEdit = await request(app)
        .put(`/projects/${projectId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ content: 'modified' });
      expect(editorEdit.status).toBe(200);

      // 3. Editor and Viewer attempt to delete project -> Refused with 403 (FR-01.4, FR-01.6)
      await request(app)
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);

      await request(app)
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .expect(403);

      // 4. Owner deletes project -> Allowed with 200 (FR-01.4)
      await request(app)
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });

  // =========================================================================
  // 4. IF-07 & NFR-08: STATELESS CLOUD SUMMARIZATION RELAY & SECURITY
  // Methodology: BVA, Timeout Fault Injection, Security & Storage Inspection (I)
  // =========================================================================
  describe('IF-07 & NFR-08: Stateless Cloud PDF Summarization Relay & Security', () => {
    let token: string;
    const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf-8');

    beforeEach(async () => {
      await request(app).post('/register').send({ username: 'researcher', password: 'Valid!Password2026' });
      token = (await request(app).post('/login').send({ username: 'researcher', password: 'Valid!Password2026' })).body.token;
    });

    test('TC-07.1 [EP & BVA - FR-05.1, FR-05.2]: Reject missing consent, non-PDF files, and PDFs > 20 MB', async () => {
      // Missing per-request consent -> 400 (FR-05.2)
      await request(app)
        .post('/summarize')
        .set('Authorization', `Bearer ${token}`)
        .field('consent', 'false')
        .attach('pdf', validPdfBuffer, 'paper.pdf')
        .expect(400);

      // Non-PDF file header -> 400 (FR-05.1)
      const invalidFile = Buffer.from('Not a PDF file content', 'utf-8');
      await request(app)
        .post('/summarize')
        .set('Authorization', `Bearer ${token}`)
        .field('consent', 'true')
        .attach('pdf', invalidFile, 'malicious.txt')
        .expect(400);

      // PDF > 20 MB (20 MB + 10 bytes BVA) -> 400 (FR-05.1)
      const oversizedPdf = Buffer.alloc(20 * 1024 * 1024 + 10, 'a');
      oversizedPdf.write('%PDF-1.4\n', 0, 'ascii');
      await request(app)
        .post('/summarize')
        .set('Authorization', `Bearer ${token}`)
        .field('consent', 'true')
        .attach('pdf', oversizedPdf, 'oversized.pdf')
        .expect(400);
    });

    test('TC-07.2 [Integration & Inspection - FR-05.4, FR-05.5, FR-05.8]: Valid PDF returns read-only summary and stores zero PDF files on server', async () => {
      const filesBefore = fs.readdirSync(path.join(__dirname, '..'));

      const res = await request(app)
        .post('/summarize')
        .set('Authorization', `Bearer ${token}`)
        .field('consent', 'true')
        .field('provider', 'default-cloud-provider')
        .attach('pdf', validPdfBuffer, 'quantum_paper.pdf');

      expect(res.status).toBe(200);
      expect(res.body.readOnly).toBe(true);
      expect(res.body.summary).toContain('quantum_paper.pdf');

      // Inspection (FR-05.8): Confirm no .pdf file was written to server directory
      const filesAfter = fs.readdirSync(path.join(__dirname, '..'));
      expect(filesAfter).toEqual(filesBefore);
    });

    test('TC-07.3 [Fault Injection - FR-05.6]: Cloud provider error or timeout returns retryable error (502/504)', async () => {
      // Simulate abort/timeout from cloud provider
      summarizationController.setCloudProviderFn(async (_buf, _name, _key, _signal) => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      });

      const timeoutRes = await request(app)
        .post('/summarize')
        .set('Authorization', `Bearer ${token}`)
        .field('consent', 'true')
        .attach('pdf', validPdfBuffer, 'timeout_paper.pdf');

      expect(timeoutRes.status).toBe(504);
      expect(timeoutRes.body.retryable).toBe(true);
    });

    test('TC-07.4 [Security Inspection - NFR-08]: Provider API credentials are AES-256-GCM encrypted at rest', () => {
      const rawPlaintext = 'sk-secret-provider-key-999';
      credentialStore.storeEncryptedKey('test-provider', rawPlaintext);

      const storedCipherHex = credentialStore.getRawCiphertextHex('test-provider');
      expect(storedCipherHex).toBeDefined();
      expect(storedCipherHex).not.toContain(Buffer.from(rawPlaintext).toString('hex'));
      expect(credentialStore.getApiKey('test-provider')).toBe(rawPlaintext);
    });
  });
});
