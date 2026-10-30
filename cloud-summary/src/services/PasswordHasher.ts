import argon2 from 'argon2';

export class PasswordHasher {
  public async hash(password: string): Promise<string> {
    // argon2.argon2id automatically generates a unique cryptographic salt per user
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MB (OWASP recommended baseline)
      timeCost: 2,
      parallelism: 1
    });
  }

  public async verify(password: string, passwordHash: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}

export const passwordHasher = new PasswordHasher();
