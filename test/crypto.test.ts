import { beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/db/crypto';

beforeEach(() => {
  process.env.SIGTIL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('secret encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const stored = encryptSecret('ghp_abc');
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('ghp_abc');
    expect(decryptSecret(stored)).toBe('ghp_abc');
  });

  it('uses a fresh iv each time', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('passes legacy plaintext through', () => {
    expect(decryptSecret('ghp_old')).toBe('ghp_old');
  });

  it('rejects a tampered value', () => {
    const stored = encryptSecret('ghp_abc');
    expect(() => decryptSecret(stored.slice(0, -2) + 'AA')).toThrow();
  });
});
