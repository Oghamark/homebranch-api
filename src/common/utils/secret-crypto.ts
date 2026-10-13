import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('SETTINGS_ENCRYPTION_KEY (or JWT_ACCESS_SECRET) must be set to store secrets');
  }
  return Buffer.from(hkdfSync('sha256', secret, 'homebranch-settings', 'secret-encryption', 32));
}

export const isEncryptedSecret = (value: string): boolean => value.startsWith(PREFIX);

/** AES-256-GCM; output is `enc:v1:<iv>:<tag>:<ciphertext>` (base64 parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

/** Values without the prefix are returned unchanged so legacy plaintext still works until re-saved. */
export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) {
    return value;
  }
  const [iv, tag, data] = value
    .slice(PREFIX.length)
    .split(':')
    .map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
