/**
 * Cryptographic primitives. Node's built-in `scrypt` is used for password
 * hashing — a memory-hard KDF that needs no native dependency — and timing-safe
 * comparison is used everywhere a secret is checked.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP-aligned scrypt parameters (N=2^16, r=8, p=1 ⇒ ~64 MiB). */
const SCRYPT = { N: 65536, r: 8, p: 1, maxmem: 160 * 1024 * 1024 } as const;
const KEY_LEN = 64;

/** Format: `scrypt$N$r$p$<saltB64>$<hashB64>` — self-describing for future rotation. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT.maxmem,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** URL-safe random token, e.g. session tokens and public tracking tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time signature check — never use `===` on a MAC. */
export function hmacVerify(payload: string, signature: string, secret: string): boolean {
  const expected = hmacSign(payload, secret);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

/** Human-facing order number: MS-<yy><mm>-<8 random chars>. Unguessable. */
export function generateOrderNumber(now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid misreads
  let suffix = '';
  for (let i = 0; i < 8; i += 1) suffix += alphabet[randomInt(alphabet.length)];
  return `MS-${yy}${mm}-${suffix}`;
}

/** Courier-style tracking code for shipments created in the admin panel. */
export function generateTrackingCode(): string {
  let digits = '';
  for (let i = 0; i < 16; i += 1) digits += randomInt(10);
  return digits;
}
