// ============================================================
// Click-Deploy — SSH Key Encryption
// ============================================================
// AES-256-GCM encryption for SSH private keys at rest.
// Uses BETTER_AUTH_SECRET as the master encryption key.
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'click-deploy-ssh-key-salt'; // Fixed salt for key derivation

/**
 * Derive a 32-byte encryption key from the master secret.
 */
function deriveKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required for SSH key encryption');
  }
  return scryptSync(secret, SALT, 32);
}

/**
 * Encrypt a plaintext SSH private key.
 * Returns a base64 string containing: IV + ciphertext + auth tag
 */
export function encryptPrivateKey(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: IV (16) + Tag (16) + Ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt an encrypted SSH private key.
 */
export function decryptPrivateKey(encryptedBase64: string): string {
  const key = deriveKey();
  const packed = Buffer.from(encryptedBase64, 'base64');

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Compute SSH key fingerprint (SHA256).
 */
export function computeFingerprint(publicKey: string): string {
  const { createHash } = require('crypto');
  // Extract base64-encoded key data from "ssh-xxx AAAA... comment" format
  const parts = publicKey.trim().split(/\s+/);
  const keyData = parts.length >= 2 ? parts[1] : parts[0];
  try {
    const hash = createHash('sha256')
      .update(Buffer.from(keyData!, 'base64'))
      .digest('base64')
      .replace(/=+$/, '');
    return `SHA256:${hash}`;
  } catch {
    return 'unknown';
  }
}
