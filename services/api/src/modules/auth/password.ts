import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// OWASP Password Storage Cheat Sheet: scrypt N=2^17, r=8, p=1. Parameters are stored in each hash
// so they can be raised later without invalidating existing passwords.
const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 64;
// Each derivation needs ~128 MB. Bounding concurrency keeps a burst of sign-in attempts from
// exhausting memory; extra requests wait their turn.
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function derive(password: string, salt: Buffer, opts: { N: number; r: number; p: number }) {
  const options: ScryptOptions = { ...opts, maxmem: 256 * 1024 * 1024 };
  return withSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) =>
          err ? reject(err) : resolve(key),
        );
      }),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/** A valid hash of a random password, used to spend equal time when an account does not exist. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
