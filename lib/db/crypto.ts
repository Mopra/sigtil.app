import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Secrets stored in the database are AES-256-GCM encrypted with a key from the
// environment: "enc:v1:" + base64(iv | auth tag | ciphertext). A value without
// the prefix is a legacy plaintext one, passed through until it is migrated.
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const raw = process.env.SIGTIL_ENCRYPTION_KEY;
  if (!raw) throw new Error('SIGTIL_ENCRYPTION_KEY is not set');
  const k = Buffer.from(raw, 'base64');
  if (k.length !== 32) throw new Error('SIGTIL_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return k;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
