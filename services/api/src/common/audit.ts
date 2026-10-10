import type { Prisma } from '../generated/prisma/client';

/**
 * Records a mutation inside the caller's transaction. Metadata holds field names and ids only,
 * never titles, notes or other personal content.
 */
export function audit(
  tx: Prisma.TransactionClient,
  entry: {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return tx.auditLog.create({ data: entry });
}
