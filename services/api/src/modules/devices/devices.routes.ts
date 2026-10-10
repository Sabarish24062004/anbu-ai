import { registerDeviceSchema, unregisterDeviceSchema } from '@anbu/shared';
import { Router } from 'express';
import { audit } from '../../common/audit';
import { currentUserId } from '../../common/middleware/require-auth';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';

/** Phones that receive reminders by remote push (development and store builds, not Expo Go). */
export function devicesRouter(prisma: PrismaClient) {
  const router = Router();

  router.post('/', async (req, res) => {
    const userId = currentUserId(req);
    const input = parseInput(registerDeviceSchema, req.body);
    // A token identifies one app install; if it was registered by another account on the same
    // phone, it now belongs to whoever is signed in.
    const device = await prisma.$transaction(async (tx) => {
      const d = await tx.notificationDevice.upsert({
        where: { pushToken: input.pushToken },
        create: { userId, ...input },
        update: { userId, ...input, revokedAt: null, lastSeenAt: new Date() },
      });
      await audit(tx, {
        userId,
        action: 'device.register',
        entityType: 'NotificationDevice',
        entityId: d.id,
      });
      return d;
    });
    res.status(201).json({ device: { id: device.id, platform: device.platform } });
  });

  // Called on sign-out, so the next person to use the phone does not get this account's alerts.
  router.post('/unregister', async (req, res) => {
    const { pushToken } = parseInput(unregisterDeviceSchema, req.body);
    await prisma.notificationDevice.updateMany({
      where: { userId: currentUserId(req), pushToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(204).end();
  });

  return router;
}
