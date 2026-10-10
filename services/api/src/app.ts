import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import type { PrismaClient } from './database/prisma';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler';
import { idempotency } from './common/middleware/idempotency';
import { requireAuth } from './common/middleware/require-auth';
import { authRouter } from './modules/auth/auth.routes';
import type { TokenConfig } from './modules/auth/tokens';
import { eventsRouter } from './modules/events/events.routes';
import { healthRouter } from './modules/health/health.routes';
import { importantDatesRouter } from './modules/important-dates/important-dates.routes';
import { remindersRouter } from './modules/reminders/reminders.routes';
import { tasksRouter } from './modules/tasks/tasks.routes';
import { usersRouter } from './modules/users/users.routes';
import pkg from '../package.json' with { type: 'json' };

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
}

export function createApp({ env, prisma, logger }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  // Native mobile requests carry no Origin header; CORS only restricts browser (Expo web) clients.
  app.use(cors({ origin: env.CORS_ORIGINS }));
  app.use(express.json({ limit: '100kb' }));
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
  app.use('/auth', authRouter({ prisma, tokens, logger }, { timezone: env.DEFAULT_TIMEZONE }));

  // Everything below requires a signed-in user and is scoped to that user.
  const authed = [requireAuth(tokens), idempotency(prisma)];
  app.use('/me', authed, usersRouter(prisma));
  app.use('/events', authed, eventsRouter(prisma));
  app.use('/tasks', authed, tasksRouter(prisma));
  app.use('/important-dates', authed, importantDatesRouter(prisma));
  app.use('/reminders', authed, remindersRouter(prisma));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
