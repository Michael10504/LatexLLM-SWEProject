import { Request, Response } from 'express';
import { userRepository } from '../repositories/UserRepository';
import { sessionStore } from '../repositories/SessionStore';
import { passwordPolicy } from '../services/PasswordPolicy';
import { passwordHasher } from '../services/PasswordHasher';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

export class AuthController {
  private static readonly GENERIC_LOGIN_ERROR = 'Invalid username or password.';
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000;
  private static readonly MAX_FAILED_ATTEMPTS = 5;

  // POST /register (UC-01, FR-07.1, FR-07.2)
  public async register(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;

      // 1. Validate username length: 3 to 32 characters (FR-07.1)
      if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
        res.status(400).json({
          violatedRule: 'Username must be between 3 and 32 characters long.'
        });
        return;
      }

      // 2. Check username uniqueness (FR-07.1, UC-01 flow 2a)
      const exists = await userRepository.existsByUsername(username);
      if (exists) {
        res.status(400).json({
          violatedRule: 'Username is already registered. Please choose another username.'
        });
        return;
      }

      // 3. Check password policy (FR-07.2, UC-01 flow 2b)
      const policyResult = passwordPolicy.check(password);
      if (!policyResult.valid) {
        res.status(400).json({
          violatedRule: policyResult.violatedRule
        });
        return;
      }

      // 4. Hash password with Argon2id and store user (FR-07.2, Sequence Diagram 1 steps 18-20)
      const saltedAdaptiveHash = await passwordHasher.hash(password);
      await userRepository.save(username, saltedAdaptiveHash);

      // 5. Return 201 Created without starting an authenticated session (Sequence Diagram 1 step 21)
      res.status(201).json({
        message: 'Registration confirmed. Please log in.'
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error during registration.' });
    }
  }

  // POST /login (UC-02, FR-07.3, FR-07.4, FR-07.5)
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;
      const now = new Date();

      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        res.status(401).json({ error: AuthController.GENERIC_LOGIN_ERROR });
        return;
      }

      // 1. Look up user (Sequence Diagram 1 step 33)
      let user = await userRepository.findByUsername(username);
      if (!user) {
        // Return identical generic error so username existence is not leaked (FR-07.3)
        res.status(401).json({ error: AuthController.GENERIC_LOGIN_ERROR });
        return;
      }

      // 2. Check if username is currently locked (FR-07.4, Sequence Diagram 1 step 35)
      if (user.lockedUntil) {
        if (user.lockedUntil.getTime() > now.getTime()) {
          res.status(423).json({
            error: 'Account is locked for 15 minutes due to 5 consecutive failed login attempts.'
          });
          return;
        } else {
          // Lockout period has expired; reset old counters before checking this attempt
          user = await userRepository.resetFailedAttempts(username);
        }
      }

      // 3. Verify password against Argon2id hash (Sequence Diagram 1 step 38)
      const credentialsValid = await passwordHasher.verify(password, user.passwordHash);

      if (!credentialsValid) {
        // Record failed attempt within 15-minute window (Sequence Diagram 1 step 40)
        const updatedUser = await userRepository.recordFailedAttempt(username, now);

        // If 5 consecutive failures within 15 minutes, lock for 15 minutes (FR-07.4, step 41-42)
        if (updatedUser.failedAttempts >= AuthController.MAX_FAILED_ATTEMPTS) {
          const lockUntil = new Date(now.getTime() + AuthController.LOCKOUT_DURATION_MS);
          await userRepository.lock(username, lockUntil);
          res.status(423).json({
            error: 'Account is locked for 15 minutes due to 5 consecutive failed login attempts.'
          });
          return;
        }

        // Otherwise return generic 401 error (FR-07.3, Sequence Diagram 1 step 45)
        res.status(401).json({ error: AuthController.GENERIC_LOGIN_ERROR });
        return;
      }

      // 4. Valid login: reset failed attempts & start 8-hour session (Sequence Diagram 1 steps 48-51)
      await userRepository.resetFailedAttempts(username);
      const token = await sessionStore.create(username, now);

      res.status(200).json({
        token,
        username,
        expiresInHours: 8
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error during login.' });
    }
  }

  // POST /logout (UC-03, FR-07.5, CD-4b)
  public async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const token = req.user?.token;
      if (token) {
        await sessionStore.invalidate(token);
      }
      res.status(200).json({ message: 'Logged out successfully.' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error during logout.' });
    }
  }
}

export const authController = new AuthController();
