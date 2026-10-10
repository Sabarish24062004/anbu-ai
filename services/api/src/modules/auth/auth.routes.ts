import { loginSchema, refreshSchema, registerSchema } from '@anbu/shared';
import { Router } from 'express';
import { AppError } from '../../common/errors';
import type { RateLimits } from '../../common/middleware/rate-limit';
import { parseInput } from '../../common/validate';
import { login, logout, refresh, register, type AuthContext } from './auth.service';

export interface AuthRouteOptions {
  timezone: string;
  registrationOpen: boolean;
}

export function authRouter(ctx: AuthContext, options: AuthRouteOptions, limits: RateLimits) {
  const router = Router();

  router.post('/register', limits.register, async (req, res) => {
    if (!options.registrationOpen) {
      throw new AppError(
        403,
        'REGISTRATION_CLOSED',
        'New accounts cannot be created on this server',
      );
    }
    const input = parseInput(registerSchema, req.body);
    res.status(201).json(await register(ctx, input, options, req.get('user-agent')));
  });

  router.post('/login', limits.loginPerIp, limits.loginPerAccount, async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    res.json(await login(ctx, input, req.get('user-agent')));
  });

  router.post('/refresh', limits.refresh, async (req, res) => {
    const { refreshToken } = parseInput(refreshSchema, req.body);
    res.json(await refresh(ctx, refreshToken, req.get('user-agent')));
  });

  router.post('/logout', async (req, res) => {
    const { refreshToken } = parseInput(refreshSchema, req.body);
    await logout(ctx, refreshToken);
    res.status(204).end();
  });

  return router;
}
