import fs from 'fs';
import path from 'path';

export interface PolicyResult {
  valid: boolean;
  violatedRule?: string;
}

export class PasswordPolicy {
  private readonly minLength: number = 8;
  private readonly maxAccepted: number = 64;
  private readonly commonList: Set<string>;

  constructor(customListPath?: string) {
    const filePath = customListPath || path.join(__dirname, '../data/common-passwords.txt');
    const content = fs.readFileSync(filePath, 'utf-8');
    const entries = content
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0);

    this.commonList = new Set(entries);
  }

  public getCommonListSize(): number {
    return this.commonList.size;
  }

  public check(password: string): PolicyResult {
    if (typeof password !== 'string' || password.length < this.minLength) {
      return {
        valid: false,
        violatedRule: `Password must be at least ${this.minLength} characters long.`
      };
    }

    if (password.length > this.maxAccepted) {
      return {
        valid: false,
        violatedRule: `Password must not exceed ${this.maxAccepted} characters.`
      };
    }

    if (this.commonList.has(password.toLowerCase())) {
      return {
        valid: false,
        violatedRule: 'Password is on the common-password list and is not allowed.'
      };
    }

    return { valid: true };
  }
}

export const passwordPolicy = new PasswordPolicy();
