import { z } from 'zod';
import { DEFAULT_APP_NAME, DEFAULT_TIMEZONE, isValidTimezone } from '@anbu/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  APP_NAME: z.string().min(1).default(DEFAULT_APP_NAME),
  DEFAULT_TIMEZONE: z
    .string()
    .default(DEFAULT_TIMEZONE)
    .refine(isValidTimezone, 'must be a valid IANA timezone'),
  // HMAC key for access tokens. Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // The reminder worker runs inside the API process; tests drive it directly instead.
  REMINDER_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  REMINDER_POLL_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  // Assistant model. Without a key the assistant reports itself unavailable; everything else works.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  // Model for voice transcription; defaults to GEMINI_MODEL.
  GEMINI_TRANSCRIBE_MODEL: z.string().min(1).optional(),
  // Request rate limits (on by default; the test setup turns them off).
  RATE_LIMITS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Remote push through Expo (only phones running a development/store build register for it).
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Needed only if "enhanced push security" is turned on for the project in the EAS dashboard.
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  // Number of reverse proxies in front of the API (0 when clients connect directly).
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Set to false after creating your own account to stop anyone else signing up.
  REGISTRATION_OPEN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report which variables are wrong without echoing their values (they may be secrets).
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
  }
  return parsed.data;
}
