import type { EventDto } from '@anbu/shared';
import { toIsoOrNull, toZonedIso } from '../../common/time';
import type { Event } from '../../generated/prisma/client';

export function toEventDto(e: Event): EventDto {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: toZonedIso(e.startAt, e.timezone),
    endAt: e.endAt ? toZonedIso(e.endAt, e.timezone) : null,
    allDay: e.allDay,
    timezone: e.timezone,
    rrule: e.rrule,
    kind: e.kind,
    location: e.location,
    category: e.category,
    priority: e.priority,
    personName: e.personName,
    status: e.status,
    travelBufferMinutes: e.travelBufferMinutes,
    prepBufferMinutes: e.prepBufferMinutes,
    remindersEnabled: e.remindersEnabled,
    reminderOffsets: e.reminderOffsets,
    completedAt: toIsoOrNull(e.completedAt),
    cancelledAt: toIsoOrNull(e.cancelledAt),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
