import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import type { PrismaClient } from './database/prisma';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler';
import { idempotency } from './common/middleware/idempotency';
import { createRateLimits, noRateLimits } from './common/middleware/rate-limit';
import { requireAuth } from './common/middleware/require-auth';
import { assistantRouter } from './modules/assistant/assistant.routes';
import type { LlmProvider, Transcriber } from './modules/assistant/llm/types';
import { accountRouter } from './modules/auth/account.routes';
import { authRouter } from './modules/auth/auth.routes';
import type { TokenConfig } from './modules/auth/tokens';
import { devicesRouter } from './modules/devices/devices.routes';
import { eventsRouter } from './modules/events/events.routes';
import { healthRouter } from './modules/health/health.routes';
import { importantDatesRouter } from './modules/important-dates/important-dates.routes';
import { memoryRouter } from './modules/memory/memory.routes';
import { planningRouter } from './modules/planning/planning.routes';
import { remindersRouter } from './modules/reminders/reminders.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';
import { usersRouter } from './modules/users/users.routes';
import pkg from '../package.json' with { type: 'json' };

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  /** The assistant's model; null when none is configured. */
  llm?: LlmProvider | null;
  /** Speech to text for voice messages; null when none is configured. */
  transcriber?: Transcriber | null;
}

const VOICE_PATH = '/assistant/voice';

export function createApp({ env, prisma, logger, llm = null, transcriber = null }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-For when a known reverse proxy is in front; otherwise clients could
  // fake their IP and slip past per-IP rate limits.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(helmet());
  // Native mobile requests carry no Origin header; CORS only restricts browser (Expo web) clients.
  app.use(cors({ origin: env.CORS_ORIGINS }));
  const limits = env.RATE_LIMITS_ENABLED ? createRateLimits() : noRateLimits;
  app.use(limits.global);

  // Small bodies everywhere. Voice uploads (a minute of compressed audio, base64) are parsed
  // further down, only after the caller is authenticated.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === VOICE_PATH ? next() : smallJson(req, res, next)));
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
      // Log only what is needed to debug; headers and bodies may contain private data.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const tokens: TokenConfig = {
    accessSecret: new TextEncoder().encode(env.JWT_ACCESS_SECRET),
    accessTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  };

  app.use('/health', healthRouter(prisma, { appName: env.APP_NAME, version: pkg.version }));
  app.use(
    '/auth',
    authRouter(
      { prisma, tokens, logger },
      { timezone: env.DEFAULT_TIMEZONE, registrationOpen: env.REGISTRATION_OPEN },
      limits,
    ),
  );

  app.use(VOICE_PATH, requireAuth(tokens), express.json({ limit: '3mb' }));

  // Everything below requires a signed-in user and is scoped to that user.
  const authed = [requireAuth(tokens), idempotency(prisma)];
  app.use('/me', authed, accountRouter({ prisma, tokens, logger }, limits), usersRouter(prisma));
  app.use('/events', authed, eventsRouter(prisma));
  app.use('/tasks', authed, tasksRouter(prisma));
  app.use('/important-dates', authed, importantDatesRouter(prisma));
  app.use('/reminders', authed, remindersRouter(prisma));
  app.use('/memories', authed, memoryRouter(prisma));
  app.use('/devices', authed, devicesRouter(prisma));
  app.use('/planning', authed, planningRouter(prisma));
  app.use(
    '/assistant',
    authed,
    limits.assistant,
    assistantRouter({ prisma, llm, transcriber, logger, appName: env.APP_NAME }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
