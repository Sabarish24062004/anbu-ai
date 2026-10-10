import { loginSchema, refreshSchema, registerSchema } from '@anbu/shared';
import { Router } from 'express';
import { parseInput } from '../../common/validate';
import { login, logout, refresh, register, type AuthContext } from './auth.service';

export function authRouter(ctx: AuthContext, defaults: { timezone: string }) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const input = parseInput(registerSchema, req.body);
    res.status(201).json(await register(ctx, input, defaults, req.get('user-agent')));
  });

  router.post('/login', async (req, res) => {
    const input = parseInput(loginSchema, req.body);
    res.json(await login(ctx, input, req.get('user-agent')));
  });

  router.post('/refresh', async (req, res) => {
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
