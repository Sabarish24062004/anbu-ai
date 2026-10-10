import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { DayPlanDto, PlanEvent, PlanSuggestion } from '@anbu/shared';
import { Card, Choice, EmptyState, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import {
  addDays,
  formatDate,
  formatDuration,
  formatTime,
  startOfToday,
  toLocalDateString,
} from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { useDayPlan } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

type Item = { kind: 'event'; e: PlanEvent } | { kind: 'task'; s: PlanSuggestion };

export default function PlanScreen() {
  const t = useT();
  const { language } = useSession();
  const [offset, setOffset] = useState<0 | 1>(0);
  const date = toLocalDateString(addDays(startOfToday(), offset));
  const query = useDayPlan(date);

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <Choice
        label={formatDate(date, language, true)}
        value={offset}
        onChange={setOffset}
        options={[
          { value: 0, label: t.today },
          { value: 1, label: t.tomorrow },
        ]}
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorBanner
          message={errorMessage(query.error, t)}
          onRetry={() => query.refetch()}
          retryLabel={t.retry}
        />
      ) : (
        <PlanBody plan={query.data.plan} />
      )}
    </Screen>
  );
}

function PlanBody({ plan }: { plan: DayPlanDto }) {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const { language } = useSession();
  if (!plan.window) return <EmptyState text={t.dayOver} />;
  const items: Item[] = [
    ...plan.events.map((e) => ({ kind: 'event' as const, e })),
    ...plan.suggestions.map((sg) => ({ kind: 'task' as const, s: sg })),
  ].sort((a, b) =>
    (a.kind === 'event' ? a.e.start : a.s.start).localeCompare(
      b.kind === 'event' ? b.e.start : b.s.start,
    ),
  );

  return (
    <>
      <Text style={[s.title, { fontSize: 20 }]}>
        {formatTime(plan.window.start, language)} – {formatTime(plan.window.end, language)} ·{' '}
        {t.freeTime(formatDuration(plan.freeMinutes, language))}
      </Text>

      {plan.allDayEvents.map((e) => (
        <Card key={e.eventId} onPress={() => router.push(`/event/${e.eventId}`)}>
          <Text style={s.muted}>{t.allDay}</Text>
          <Text style={s.title}>{e.title}</Text>
        </Card>
      ))}

      {items.length === 0 && plan.unscheduled.length === 0 && <EmptyState text={t.nothingToPlan} />}

      {items.map((item) =>
        item.kind === 'event' ? (
          <Card
            key={`e-${item.e.eventId}-${item.e.start}`}
            onPress={() => router.push(`/event/${item.e.eventId}`)}
          >
            <Text style={s.muted}>
              {formatTime(item.e.start, language)} – {formatTime(item.e.end, language)}
            </Text>
            <Text style={s.title}>{item.e.title}</Text>
            {item.e.location ? <Text style={s.muted}>{item.e.location}</Text> : null}
            {item.e.bufferMinutes > 0 ? (
              <Text style={s.muted}>{t.travelBefore(item.e.bufferMinutes)}</Text>
            ) : null}
          </Card>
        ) : (
          <Pressable
            key={`t-${item.s.taskId}`}
            onPress={() => router.push(`/task/${item.s.taskId}`)}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                padding: 14,
                gap: 4,
                borderRadius: 14,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: colors.primary,
              },
              pressed && s.pressed,
            ]}
          >
            <Text style={[s.muted, { color: colors.primary, fontWeight: '600' }]}>
              {t.suggested} · {formatTime(item.s.start, language)} –{' '}
              {formatTime(item.s.end, language)}
            </Text>
            <Text style={s.title}>{item.s.title}</Text>
            {item.s.afterDue ? (
              <Text style={[s.muted, { color: colors.warning }]}>{t.afterDue}</Text>
            ) : null}
          </Pressable>
        ),
      )}

      {plan.unscheduled.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={s.section}>{t.noTimeFor}</Text>
          {plan.unscheduled.map((u) => (
            <Pressable
              key={u.taskId}
              onPress={() => router.push(`/task/${u.taskId}`)}
              accessibilityRole="button"
            >
              <Text style={s.body}>
                • {u.title}
                {u.reason === 'blocked' ? ` (${t.waitingOnTask})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {plan.importantDates.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={s.section}>{t.importantDatesSoon}</Text>
          {plan.importantDates.map((d) => (
            <Text key={`${d.title}-${d.date}`} style={s.body}>
              • {t.briefDate(d.title, d.daysUntil)}
            </Text>
          ))}
        </View>
      )}
    </>
  );
}
