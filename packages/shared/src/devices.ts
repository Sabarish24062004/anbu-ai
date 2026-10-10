import { z } from 'zod';

export const expoPushTokenSchema = z
  .string()
  .max(200)
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/, 'must be an Expo push token');

export const registerDeviceSchema = z.strictObject({
  platform: z.enum(['IOS', 'ANDROID']),
  pushToken: expoPushTokenSchema,
  deviceName: z.string().trim().max(100).optional(),
  permissionStatus: z.enum(['granted', 'denied', 'undetermined']).optional(),
});
export type RegisterDeviceInput = z.input<typeof registerDeviceSchema>;

export const unregisterDeviceSchema = z.strictObject({ pushToken: expoPushTokenSchema });
