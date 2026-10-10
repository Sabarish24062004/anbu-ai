import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:secret-pw@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.DEFAULT_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.APP_NAME).toBe('Anbu AI');
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
  });

  it('requires a long access-token secret', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects an invalid timezone', () => {
    expect(() => loadEnv({ ...base, DEFAULT_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /DEFAULT_TIMEZONE/,
    );
  });

  it('does not leak secret values in error messages', () => {
    try {
      loadEnv({ ...base, DATABASE_URL: 'mysql://u:secret-pw@x/db' });
      expect.fail('should throw');
    } catch (e) {
      expect(String(e)).toContain('DATABASE_URL');
      expect(String(e)).not.toContain('secret-pw');
    }
  });
});
