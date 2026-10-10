import {
  MEMORY_MAX_PER_USER,
  saveMemorySchema,
  type MemoryDto,
  type SaveMemoryInput,
} from '@anbu/shared';
import { audit } from '../../common/audit';
import { AppError, notFound } from '../../common/errors';
import { parseInput } from '../../common/validate';
import type { PrismaClient } from '../../database/prisma';
import type { Memory } from '../../generated/prisma/client';

export function toMemoryDto(m: Memory): MemoryDto {
  return {
    id: m.id,
    key: m.key,
    value: m.value,
    category: m.category,
    source: m.source,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listMemories(prisma: PrismaClient, userId: string) {
  const rows = await prisma.memory.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  return rows.map(toMemoryDto);
}

/** Saves (or replaces, by key) something the user explicitly told the assistant. */
export async function saveMemory(
  prisma: PrismaClient,
  userId: string,
  raw: SaveMemoryInput,
): Promise<MemoryDto> {
  const input = parseInput(saveMemorySchema, raw);
  const existing = await prisma.memory.findUnique({
    where: { userId_key: { userId, key: input.key } },
  });
  if (!existing && (await prisma.memory.count({ where: { userId } })) >= MEMORY_MAX_PER_USER) {
    throw new AppError(
      409,
      'MEMORY_FULL',
      `At most ${MEMORY_MAX_PER_USER} things can be remembered`,
    );
  }
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.memory.upsert({
      where: { userId_key: { userId, key: input.key } },
      create: {
        userId,
        key: input.key,
        value: input.value,
        category: input.category ?? null,
        source: 'USER_STATED',
      },
      update: { value: input.value, category: input.category ?? existing?.category ?? null },
    });
    await audit(tx, {
      userId,
      action: existing ? 'memory.update' : 'memory.create',
      entityType: 'Memory',
      entityId: saved.id,
      metadata: { key: saved.key },
    });
    return saved;
  });
  return toMemoryDto(row);
}

/** Forgets one memory by id or key. Returns false when nothing matched. */
export async function forgetMemory(
  prisma: PrismaClient,
  userId: string,
  by: { id: string } | { key: string },
): Promise<boolean> {
  const row = await prisma.memory.findFirst({ where: { userId, ...by } });
  if (!row) return false;
  await prisma.$transaction(async (tx) => {
    await tx.memory.delete({ where: { id: row.id } });
    await audit(tx, {
      userId,
      action: 'memory.delete',
      entityType: 'Memory',
      entityId: row.id,
      metadata: { key: row.key },
    });
  });
  return true;
}

export async function forgetAllMemories(prisma: PrismaClient, userId: string) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.memory.deleteMany({ where: { userId } });
    await audit(tx, {
      userId,
      action: 'memory.delete_all',
      entityType: 'Memory',
      metadata: { count },
    });
    return count;
  });
}

export async function deleteMemoryById(prisma: PrismaClient, userId: string, id: string) {
  if (!(await forgetMemory(prisma, userId, { id }))) throw notFound('Memory');
}
