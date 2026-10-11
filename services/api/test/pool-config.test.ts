import { describe, expect, it } from 'vitest';
import { poolConfig } from '../src/database/prisma';

describe('poolConfig', () => {
  const base = 'postgresql://user:pw@db.example.com:5432/app';

  it('leaves a URL without sslmode unencrypted', () => {
    expect(poolConfig(base)).toEqual({ connectionString: base, ssl: undefined });
  });

  it('encrypts without verifying for sslmode=require (libpq meaning)', () => {
    const c = poolConfig(`${base}?sslmode=require`);
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.connectionString).toBe(base);
  });

  it('verifies the certificate for verify-full', () => {
    expect(poolConfig(`${base}?sslmode=verify-full`).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('keeps other parameters', () => {
    const c = poolConfig(`${base}?sslmode=disable&application_name=anbu`);
    expect(c.ssl).toBeUndefined();
    expect(c.connectionString).toBe(`${base}?application_name=anbu`);
  });
});
