import { useState } from 'react';
import { Text, View } from 'react-native';
import type { EventDto, EventExceptionDto } from '@anbu/shared';
import { api } from '@/lib/api';
import { formatDate, formatTime, toLocalDateTimeString, wallToLocalDate } from '@/lib/datetime';
import { confirm, errorMessage, scheduleConflicts } from '@/lib/errors';
import { keys, useInvalidatingMutation } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { DateTimeField } from './DateTimeField';
import { Button, Card, ErrorBanner, useStyles } from './ui';

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/**
 * Actions for one occurrence of a repeating event (skip, move, restore), plus the list of
 * occurrences that were changed. `originalStart` is the occurrence the user opened, if any.
 */
export function OccurrenceCard({
  event,
  exceptions,
  originalStart,
}: {
  event: EventDto;
  exceptions: EventExceptionDto[];
  originalStart?: string;
}) {
  const s = useStyles();
  const t = useT();
  const { language } = useSession();
  const [moving, setMoving] = useState(false);
  const current = originalStart
    ? exceptions.find((x) => sameInstant(x.originalStart, originalStart))
    : undefined;
  const [newStart, setNewStart] = useState(() =>
    wallToLocalDate(current?.startAt ?? originalStart ?? event.startAt),
  );

  const refresh = [keys.events, keys.plan] as const;
  const skip = useInvalidatingMutation(() => api.skipOccurrence(event.id, originalStart!), refresh);
  const move = useInvalidatingMutation(
    (allowConflicts: boolean) =>
      api.moveOccurrence(event.id, {
        occurrence: originalStart!,
        startAt: toLocalDateTimeString(newStart),
        allowConflicts,
      }),
    refresh,
    () => setMoving(false),
  );
  const restore = useInvalidatingMutation(
    (exceptionId: string) => api.restoreOccurrence(event.id, exceptionId),
    refresh,
  );

  const label = (iso: string) =>
    event.allDay
      ? formatDate(iso, language)
      : `${formatDate(iso, language)} ${formatTime(iso, language)}`;

  const saveMove = (allowConflicts = false) =>
    move.mutate(allowConflicts, {
      onError: async (err) => {
        const conflicts = scheduleConflicts(err);
        if (!conflicts) return;
        const ok = await confirm({
          title: t.conflictTitle,
          message: t.conflictBody(conflicts.map((c) => `• ${c.title}`).join('\n')),
          confirmLabel: t.saveAnyway,
          cancelLabel: t.cancel,
        });
        if (ok) saveMove(true);
      },
    });

  const failed = skip.error ?? restore.error ?? (scheduleConflicts(move.error) ? null : move.error);

  return (
    <Card>
      {originalStart && (
        <View style={{ gap: 8 }}>
          <Text style={s.title}>
            {t.thisOccurrence}: {label(originalStart)}
          </Text>
          {current ? (
            <>
              <Text style={s.muted}>
                {current.kind === 'SKIPPED'
                  ? t.occurrenceSkipped
                  : t.occurrenceMovedTo(label(current.startAt!))}
              </Text>
              <Button
                label={t.restoreOccurrence}
                variant="secondary"
                loading={restore.isPending}
                onPress={() => restore.mutate(current.id)}
              />
            </>
          ) : null}
          {current?.kind !== 'SKIPPED' && !moving && (
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              <Button
                label={t.skipThisOne}
                variant="secondary"
                loading={skip.isPending}
                onPress={() => skip.mutate(undefined)}
              />
              <Button label={t.moveThisOne} variant="secondary" onPress={() => setMoving(true)} />
            </View>
          )}
          {moving && (
            <>
              <DateTimeField
                label={t.starts}
                value={newStart}
                onChange={setNewStart}
                mode={event.allDay ? 'date' : 'datetime'}
                language={language}
              />
              <View style={[s.row, { flexWrap: 'wrap' }]}>
                <Button label={t.save} loading={move.isPending} onPress={() => saveMove()} />
                <Button label={t.cancel} variant="secondary" onPress={() => setMoving(false)} />
              </View>
            </>
          )}
          {failed && <ErrorBanner message={errorMessage(failed, t)} />}
        </View>
      )}

      {exceptions.length > 0 && (
        <View style={{ gap: 6, marginTop: originalStart ? 12 : 0 }}>
          <Text style={s.section}>{t.changedOccurrences}</Text>
          {exceptions.map((x) => (
            <View key={x.id} style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[s.body, { flexShrink: 1 }]}>
                {label(x.originalStart)} →{' '}
                {x.kind === 'SKIPPED' ? t.occurrenceSkipped : label(x.startAt!)}
              </Text>
              <Button
                label={t.restoreOccurrence}
                variant="secondary"
                loading={restore.isPending && restore.variables === x.id}
                onPress={() => restore.mutate(x.id)}
              />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}
