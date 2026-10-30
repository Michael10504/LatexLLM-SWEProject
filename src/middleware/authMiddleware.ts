import { Request, Response, NextFunction } from 'express';
import { sessionStore } from '../repositories/SessionStore';

export interface AuthenticatedRequest extends Request {
  user?: {
    username: string;
    token: string;
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Please log in.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Authentication required. Please log in.' });
      return;
    }

    const session = await sessionStore.findByToken(token);
    if (!session) {
      res.status(401).json({ error: 'Invalid or terminated session. Please log in.' });
      return;
    }

    // Check 8-hour inactivity limit (FR-07.5, UC-03 flow 1b)
    const now = new Date();
    if (sessionStore.isExpired(session, now)) {
      await sessionStore.invalidate(token);
      res.status(401).json({ error: 'Session expired after 8 hours of inactivity.' });
      return;
    }

    // Refresh sliding 8-hour inactivity timer (CD-1 Session.touch)
    await sessionStore.touch(token, now);

    req.user = {
      username: session.username,
      token: session.token
    };

    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error during session verification.' });
  }
}
