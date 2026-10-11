import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { OccurrenceCard } from '@/components/OccurrenceCard';
import { Button, Card, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/datetime';
import { confirm, errorMessage } from '@/lib/errors';
import { keys, useEvent, useInvalidatingMutation } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { goBack } from '@/lib/navigation';

export default function EventDetailScreen() {
  // `at`: the occurrence opened from the agenda (its original start), for repeating events.
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();
  const s = useStyles();
  const t = useT();
  const { language } = useSession();
  const query = useEvent(id);
  const complete = useInvalidatingMutation(() => api.completeEvent(id), [keys.events]);
  const cancel = useInvalidatingMutation(() => api.cancelEvent(id), [keys.events]);
  const remove = useInvalidatingMutation(
    () => api.deleteEvent(id),
    [keys.events],
    () => goBack('/'),
  );
  const failed = complete.error ?? cancel.error ?? remove.error;

  if (query.isPending)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (query.isError)
    return (
      <Screen>
        <ErrorBanner message={errorMessage(query.error, t)} />
      </Screen>
    );

  const e = query.data.event;
  const when = e.allDay
    ? `${formatDate(e.startAt, language, true)} · ${t.allDay}`
    : `${formatDate(e.startAt, language, true)} · ${formatTime(e.startAt, language)}${
        e.endAt ? ` – ${formatTime(e.endAt, language)}` : ''
      }`;
  const repeatLabel = {
    DAILY: t.repeatDaily,
    WEEKLY: t.repeatWeekly,
    MONTHLY: t.repeatMonthly,
    YEARLY: t.repeatYearly,
  }[/FREQ=(\w+)/.exec(e.rrule ?? '')?.[1] ?? ''];
  const scheduled = e.status === 'SCHEDULED';

  return (
    <Screen>
      <Card>
        <Text style={[s.title, { fontSize: 22 }]}>{e.title}</Text>
        <Text style={s.body}>{when}</Text>
        {repeatLabel ? (
          <Text style={s.muted}>
            {t.repeat}: {repeatLabel}
          </Text>
        ) : null}
        {e.location ? <Text style={s.body}>{e.location}</Text> : null}
        {e.description ? <Text style={s.body}>{e.description}</Text> : null}
        {e.remindersEnabled && e.reminderOffsets[0] !== undefined ? (
          <Text style={s.muted}>
            {t.reminder}: {t.minutesBefore(e.reminderOffsets[0])}
          </Text>
        ) : null}
        {!scheduled && (
          <Text style={[s.title, { marginTop: 4 }]}>
            {e.status === 'COMPLETED' ? t.statusCompleted : t.statusCancelled}
          </Text>
        )}
      </Card>

      {e.rrule && scheduled && (
        <OccurrenceCard event={e} exceptions={query.data.exceptions} originalStart={at} />
      )}

      {failed && <ErrorBanner message={errorMessage(failed, t)} />}

      <View style={{ gap: 10 }}>
        {scheduled && (
          <>
            <Button label={t.edit} onPress={() => router.push(`/event/${id}/edit`)} />
            <Button
              label={t.markDone}
              variant="secondary"
              loading={complete.isPending}
              onPress={() => complete.mutate(undefined)}
            />
            <Button
              label={t.cancelEvent}
              variant="secondary"
              loading={cancel.isPending}
              onPress={async () => {
                const ok = await confirm({
                  title: t.cancelEvent,
                  message: t.cancelConfirm,
                  confirmLabel: t.cancelEvent,
                  cancelLabel: t.keep,
                  destructive: true,
                });
                if (ok) cancel.mutate(undefined);
              }}
            />
          </>
        )}
        <Button
          label={t.delete}
          variant="danger"
          loading={remove.isPending}
          onPress={async () => {
            const ok = await confirm({
              title: t.delete,
              message: t.deleteConfirm,
              confirmLabel: t.delete,
              cancelLabel: t.keep,
              destructive: true,
            });
            if (ok) remove.mutate(undefined);
          }}
        />
      </View>
    </Screen>
  );
}
