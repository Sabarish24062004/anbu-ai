import { z } from 'zod';

export const MEMORY_MAX_PER_USER = 100;

/** Long digit runs look like card, account, ID or OTP numbers, which are never stored. */
export const looksSecret = (value: string) => /\d[\d\s-]{10,}\d/.test(value);

export const memoryKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(60)
  .transform((k) => k.replace(/[^a-z0-9஀-௿]+/g, '_').replace(/^_+|_+$/g, ''))
  .pipe(z.string().min(1, 'key must contain letters or numbers'));

export const saveMemorySchema = z.strictObject({
  /** Short stable name, e.g. "wake_time", "gym_location". Saving the same key replaces it. */
  key: memoryKeySchema,
  value: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((v) => !looksSecret(v), 'looks like a card, account or ID number; not stored'),
  category: z.string().trim().max(30).optional(),
});
export type SaveMemoryInput = z.input<typeof saveMemorySchema>;

export interface MemoryDto {
  id: string;
  key: string;
  value: string;
  category: string | null;
  source: 'USER_STATED' | 'USER_CONFIRMED';
  createdAt: string;
  updatedAt: string;
}
