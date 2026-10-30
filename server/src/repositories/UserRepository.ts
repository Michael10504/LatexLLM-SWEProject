import { User } from '@prisma/client';
import { prisma } from '../config/db';

export class UserRepository {
  public async existsByUsername(username: string): Promise<boolean> {
    const count = await prisma.user.count({
      where: { username }
    });
    return count > 0;
  }

  public async findByUsername(username: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { username }
    });
  }

  public async save(username: string, passwordHash: string): Promise<User> {
    return await prisma.user.create({
      data: {
        username,
        passwordHash,
        failedAttempts: 0,
        firstFailedAt: null,
        lockedUntil: null
      }
    });
  }

  public async recordFailedAttempt(username: string, now: Date = new Date()): Promise<User> {
    const user = await this.findByUsername(username);
    if (!user) {
      throw new Error('User not found');
    }

    const fifteenMinutesMs = 15 * 60 * 1000;
    const windowExpired =
      !user.firstFailedAt || now.getTime() - user.firstFailedAt.getTime() > fifteenMinutesMs;

    const newFailedAttempts = windowExpired ? 1 : user.failedAttempts + 1;
    const newFirstFailedAt = windowExpired ? now : user.firstFailedAt;

    return await prisma.user.update({
      where: { username },
      data: {
        failedAttempts: newFailedAttempts,
        firstFailedAt: newFirstFailedAt
      }
    });
  }

  public async lock(username: string, until: Date): Promise<User> {
    return await prisma.user.update({
      where: { username },
      data: {
        lockedUntil: until
      }
    });
  }

  public async resetFailedAttempts(username: string): Promise<User> {
    return await prisma.user.update({
      where: { username },
      data: {
        failedAttempts: 0,
        firstFailedAt: null,
        lockedUntil: null
      }
    });
  }
}

export const userRepository = new UserRepository();
