// ============================================================
// Click-Deploy — SSH Key Encryption
// ============================================================
// AES-256-GCM encryption for SSH private keys at rest.
// Uses ENCRYPTION_KEY or BETTER_AUTH_SECRET as the master encryption key.
// ============================================================
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const OLD_SALT = 'click-deploy-ssh-key-salt'; // Fixed salt for legacy keys

/**
 * Derive a 32-byte encryption key from the master secret.
 */
function deriveKey(salt: string | Buffer): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY or BETTER_AUTH_SECRET is required for SSH key encryption');
  }
  return scryptSync(secret, salt, 32);
}

/**
 * Encrypt a plaintext SSH private key.
 * Returns a string formatted as: v2:<base64-packed-data>
 * Packed data contains: Salt + IV + Tag + Ciphertext
 */
export function encryptPrivateKey(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: Salt (16) + IV (16) + Tag (16) + Ciphertext
  const packed = Buffer.concat([salt, iv, tag, encrypted]);
  return `v2:${packed.toString('base64')}`;
}

/**
 * Decrypt an encrypted SSH private key.
 */
export function decryptPrivateKey(encryptedString: string): string {
  if (encryptedString.startsWith('v2:')) {
    // New v2 format — always uses ENCRYPTION_KEY (or BETTER_AUTH_SECRET fallback)
    const packed = Buffer.from(encryptedString.slice(3), 'base64');
    
    const salt = packed.subarray(0, SALT_LENGTH);
    const iv = packed.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = packed.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const ciphertext = packed.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = deriveKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  // Legacy format — keys were encrypted with BETTER_AUTH_SECRET before ENCRYPTION_KEY existed.
  // Try both secrets: BETTER_AUTH_SECRET first (original), then ENCRYPTION_KEY as fallback.
  const packed = Buffer.from(encryptedString, 'base64');
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const secretsToTry = [
    process.env.BETTER_AUTH_SECRET,
    process.env.ENCRYPTION_KEY,
  ].filter(Boolean) as string[];

  for (const secret of secretsToTry) {
    try {
      const key = scryptSync(secret, OLD_SALT, 32);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Try next secret
    }
  }
  throw new Error('Failed to decrypt legacy SSH key — neither BETTER_AUTH_SECRET nor ENCRYPTION_KEY could decrypt it');
}

/**
 * Encrypt a JSON object containing environment variables.
 */
export function encryptEnvVars(envVars: Record<string, string>): string {
  return encryptPrivateKey(JSON.stringify(envVars || {}));
}

/**
 * Decrypt an encrypted JSON object into a Record<string, string>.
 * Falls back to returning the raw object if it's not encrypted (legacy support).
 */
export function decryptEnvVars(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'string' && raw.startsWith('v2:')) {
    try {
      return JSON.parse(decryptPrivateKey(raw));
    } catch {
      return {};
    }
  }
  // legacy unencrypted parsing
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw as Record<string, string>;
  }
  return {};
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
