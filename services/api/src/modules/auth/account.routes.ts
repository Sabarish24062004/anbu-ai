import { changePasswordSchema, deleteAccountSchema } from '@anbu/shared';
import { Router } from 'express';
import type { RateLimits } from '../../common/middleware/rate-limit';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseInput } from '../../common/validate';
import { changePassword, deleteAccount, exportAccount } from './account.service';
import type { AuthContext } from './auth.service';

/** Account-level actions for the signed-in user, mounted under /me. */
export function accountRouter(ctx: AuthContext, limits: RateLimits) {
  const router = Router();

  // Password checks count toward the same failed-attempt limit as sign-in.
  router.post('/password', limits.loginPerIp, async (req, res) => {
    const input = parseInput(changePasswordSchema, req.body);
    res.json(await changePassword(ctx, currentUserId(req), input, req.get('user-agent')));
  });

  router.get('/export', async (req, res) => {
    const data = await exportAccount(ctx, currentUserId(req));
    res
      .set(
        'Content-Disposition',
        `attachment; filename="anbu-ai-export-${data.exportedAt.slice(0, 10)}.json"`,
      )
      .set('Cache-Control', 'no-store')
      .json(data);
  });

  router.delete('/', limits.loginPerIp, async (req, res) => {
    const { password } = parseInput(deleteAccountSchema, req.body);
    await deleteAccount(ctx, currentUserId(req), password);
    res.status(204).end();
  });

  return router;
}
