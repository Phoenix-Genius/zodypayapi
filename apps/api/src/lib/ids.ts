import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Cryptographically random base62 string. 24 chars ≈ 142 bits. */
export function randomToken(length = 24): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function newId(prefix: string, length = 20): string {
  return `${prefix}_${randomToken(length)}`;
}
