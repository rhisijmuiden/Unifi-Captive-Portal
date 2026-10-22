import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { config } from '../config.js';

const key = createHash('sha256').update(`${config.appSecret}:settings`).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload.replace(/^v1:/, ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const hashPassword = (password: string) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password).catch(() => false);

// No look-alikes (0/O, 1/l/I), so a password read out or retyped from a chat message stays correct
const PASSWORD_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A strong password that is easy to copy: four groups of five characters (about 116 bits). */
export function generatePassword() {
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]).join(''));
  return groups.join('-');
}
