import crypto from 'crypto';

interface EncryptedPayload {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

export class CredentialStore {
  // CD-3c: -encryptedKeys : Map<String, Bytes>
  private readonly encryptedKeys: Map<string, EncryptedPayload> = new Map();
  private readonly masterKey: Buffer;

  constructor() {
    // Derive a 256-bit encryption key from server secret or generate one per boot
    const secret = process.env.CREDENTIAL_MASTER_SECRET;
    this.masterKey = secret ? crypto.createHash('sha256').update(secret).digest() : crypto.randomBytes(32);

    // Pre-load and encrypt the configured cloud summarization provider API key
    const initialProviderKey = process.env.CLOUD_SUMMARY_API_KEY;
    if (initialProviderKey) this.storeEncryptedKey('default-cloud-provider', initialProviderKey);
  }

  public storeEncryptedKey(provider: string, rawApiKey: string): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(rawApiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    this.encryptedKeys.set(provider, { iv, authTag, ciphertext });
  }

  // CD-3c: +getApiKey(provider : String) : String
  public getApiKey(provider: string = 'default-cloud-provider'): string {
    const record = this.encryptedKeys.get(provider);
    if (!record) {
      throw new Error(`No encrypted API key found for provider: ${provider}`);
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, record.iv);
    decipher.setAuthTag(record.authTag);
    const decrypted = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  // Helper for NFR-08 inspection tests: verifies stored bytes are ciphertext, not plaintext
  public getRawCiphertextHex(provider: string = 'default-cloud-provider'): string | undefined {
    return this.encryptedKeys.get(provider)?.ciphertext.toString('hex');
  }
}

export const credentialStore = new CredentialStore();
