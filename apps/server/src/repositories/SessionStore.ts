import crypto from 'crypto';
import { Session } from '@prisma/client';
import { prisma } from '../config/db';

export class SessionStore {
  // 8 hours in milliseconds (FR-07.5, CD-1)
  public static readonly INACTIVITY_LIMIT_MS = 8 * 60 * 60 * 1000;

  // Create a new session with a 256-bit cryptographically random token (CD-4b)
  public async create(username: string, now: Date = new Date()): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.session.create({
      data: {
        token,
        username,
        lastActivity: now
      }
    });
    return token;
  }

  public async findByToken(token: string): Promise<Session | null> {
    return await prisma.session.findUnique({
      where: { token }
    });
  }

  // CD-1 Session.isExpired(): checks if > 8 hours have passed since lastActivity
  public isExpired(session: Session, now: Date = new Date()): boolean {
    const elapsedMs = now.getTime() - session.lastActivity.getTime();
    return elapsedMs > SessionStore.INACTIVITY_LIMIT_MS;
  }

  // CD-1 Session.touch(): updates sliding 8-hour window on valid activity
  public async touch(token: string, now: Date = new Date()): Promise<Session> {
    return await prisma.session.update({
      where: { token },
      data: { lastActivity: now }
    });
  }

  // CD-4b SessionStore.invalidate(token) & expire(session)
  public async invalidate(token: string): Promise<void> {
    await prisma.session.deleteMany({
      where: { token }
    });
  }
}

export const sessionStore = new SessionStore();
