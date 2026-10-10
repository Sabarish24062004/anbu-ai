import { router } from 'expo-router';
import { Text, View } from 'react-native';
import type { EventOccurrenceDto } from '@anbu/shared';
import { DueReminders } from '@/components/DueReminders';
import { Button, Card, EmptyState, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import {
  addDays,
  dayKey,
  formatDate,
  formatMonthDay,
  formatTime,
  startOfToday,
  toLocalDateString,
} from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { AGENDA_DAYS, useAgenda, useUpcomingDates } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';

export default function AgendaScreen() {
  const s = useStyles();
  const t = useT();
  const { language, session } = useSession();
  const agenda = useAgenda();
  const dates = useUpcomingDates(AGENDA_DAYS);

  const today = toLocalDateString(startOfToday());
  const tomorrow = toLocalDateString(addDays(startOfToday(), 1));
  const dayLabel = (key: string) =>
    key === today ? t.today : key === tomorrow ? t.tomorrow : formatDate(key, language);

  const byDay = new Map<string, EventOccurrenceDto[]>();
  for (const o of agenda.data?.occurrences ?? []) {
    const key = dayKey(o.start);
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }

  return (
    <Screen
      refreshing={agenda.isRefetching}
      onRefresh={() => {
        void agenda.refetch();
        void dates.refetch();
      }}
    >
      {session?.user.displayName ? (
        <Text style={[s.title, { fontSize: 22 }]}>
          {t.greeting} {session.user.displayName}
        </Text>
      ) : null}
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <View style={{ flexGrow: 1 }}>
          <Button label={t.addEvent} onPress={() => router.push('/event/new')} />
        </View>
        <View style={{ flexGrow: 1 }}>
          <Button label={t.planMyDay} variant="secondary" onPress={() => router.push('/plan')} />
        </View>
      </View>
      <DueReminders />

      {dates.data?.upcoming.length ? (
        <>
          <Text style={s.section}>{t.importantDatesSoon}</Text>
          {dates.data.upcoming.map((u) => (
            <Card
              key={u.importantDate.id}
              onPress={() => router.push(`/date/${u.importantDate.id}`)}
            >
              <Text style={s.title}>{u.importantDate.title}</Text>
              <Text style={s.muted}>
                {t.inDays(u.daysUntil)} ·{' '}
                {formatMonthDay(u.importantDate.month, u.importantDate.day, language)}
              </Text>
            </Card>
          ))}
        </>
      ) : null}

      {agenda.isPending ? (
        <Loading />
      ) : agenda.isError ? (
        <ErrorBanner
          message={errorMessage(agenda.error, t)}
          onRetry={() => agenda.refetch()}
          retryLabel={t.retry}
        />
      ) : byDay.size === 0 ? (
        <EmptyState text={t.nothingScheduled} />
      ) : (
        [...byDay.entries()].map(([key, items]) => (
          <View key={key} style={{ gap: 8 }}>
            <Text style={s.section} accessibilityRole="header">
              {dayLabel(key)}
            </Text>
            {items.map((o) => (
              <Card
                key={`${o.eventId}-${o.start}`}
                onPress={() =>
                  router.push(
                    o.event.rrule
                      ? `/event/${o.eventId}?at=${encodeURIComponent(o.originalStart)}`
                      : `/event/${o.eventId}`,
                  )
                }
              >
                <Text style={s.muted}>
                  {o.event.allDay
                    ? t.allDay
                    : `${formatTime(o.start, language)}${o.event.endAt ? ` – ${formatTime(o.end, language)}` : ''}`}
                </Text>
                <Text
                  style={[
                    s.title,
                    o.event.status === 'COMPLETED' && { textDecorationLine: 'line-through' },
                  ]}
                >
                  {o.event.title}
                </Text>
                {o.event.location ? <Text style={s.muted}>{o.event.location}</Text> : null}
                {o.moved ? <Text style={s.muted}>{t.movedOccurrence}</Text> : null}
              </Card>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
