import crypto from 'crypto';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const GCM_IV_LENGTH = 12;
const CBC_IV_LENGTH = 16;
const GCM_AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export function encryptBuffer({ buffer, password, algorithm = 'aes-256-gcm', mimeType, originalName }) {
  if (!password) {
    throw new Error('Password is required');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const ivLength = algorithm === 'aes-256-cbc' ? CBC_IV_LENGTH : GCM_IV_LENGTH;
  const iv = crypto.randomBytes(ivLength);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  let encryptedData;
  let authTag = null;
  let cipher;

  if (algorithm === 'aes-256-gcm') {
    cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    encryptedData = Buffer.concat([cipher.update(buffer), cipher.final()]);
    authTag = cipher.getAuthTag();
  } else if (algorithm === 'aes-256-cbc') {
    cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    encryptedData = Buffer.concat([cipher.update(buffer), cipher.final()]);
  } else {
    throw new Error('Unsupported algorithm');
  }

  return {
    encryptedData,
    salt,
    iv,
    authTag,
    metadata: {
      algorithm,
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag ? authTag.toString('hex') : null,
      mimeType: mimeType || 'application/octet-stream',
      originalName: originalName || 'image',
      keyLength: KEY_LENGTH,
    },
  };
}

export function decryptBuffer({ encryptedData, password, saltHex, ivHex, authTagHex, algorithm = 'aes-256-gcm' }) {
  if (!password) {
    throw new Error('Password is required');
  }

  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');

  try {
    if (algorithm === 'aes-256-gcm') {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      if (!authTagHex) {
        throw new Error('authTag is required for AES-GCM');
      }
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    }

    if (algorithm === 'aes-256-cbc') {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    }

    throw new Error('Unsupported algorithm');
  } catch (error) {
    throw new Error('Decryption failed. Wrong password or corrupted data.');
  }
}

export const encryptionConstants = {
  PBKDF2_ITERATIONS,
  SALT_LENGTH,
  GCM_IV_LENGTH,
  CBC_IV_LENGTH,
  GCM_AUTH_TAG_LENGTH,
  KEY_LENGTH,
};
