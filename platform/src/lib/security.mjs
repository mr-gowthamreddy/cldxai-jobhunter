// Password hashing (scrypt, per-password salt) and opaque token helpers.
// Only hashes of session and reset tokens are stored; the raw token lives in
// the user's cookie or email link.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A real hash to compare against when the email is unknown, so the response
// time does not reveal whether an account exists.
let dummyHash = null;
export async function dummyVerify(password) {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password-' + randomBytes(8).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** Password policy: at least 8 chars with a letter and a digit, max 200. */
export function passwordProblems(pw) {
  const p = String(pw || '');
  const problems = [];
  if (p.length < 8) problems.push('at least 8 characters');
  if (p.length > 200) problems.push('at most 200 characters');
  if (!/[A-Za-z]/.test(p)) problems.push('a letter');
  if (!/\d/.test(p)) problems.push('a number');
  return problems;
}
