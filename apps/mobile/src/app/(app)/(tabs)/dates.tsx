import { router } from 'expo-router';
import { Text } from 'react-native';
import type { UpcomingImportantDateDto } from '@anbu/shared';
import { Button, Card, EmptyState, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import { formatMonthDay } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { useUpcomingDates } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';

// A full year ahead shows every recurring date exactly once, soonest first.
const DAYS_AHEAD = 366;

export default function DatesScreen() {
  const s = useStyles();
  const t = useT();
  const { language } = useSession();
  const dates = useUpcomingDates(DAYS_AHEAD);

  const detail = (u: UpcomingImportantDateDto) => {
    const parts = [
      t.inDays(u.daysUntil),
      formatMonthDay(u.importantDate.month, u.importantDate.day, language),
    ];
    if (u.yearsSince != null && u.yearsSince > 0) {
      parts.push(
        u.importantDate.type === 'BIRTHDAY' ? t.turns(u.yearsSince) : t.years(u.yearsSince),
      );
    }
    return parts.join(' · ');
  };

  return (
    <Screen refreshing={dates.isRefetching} onRefresh={() => void dates.refetch()}>
      <Button label={t.addDate} onPress={() => router.push('/date/new')} />
      {dates.isPending ? (
        <Loading />
      ) : dates.isError ? (
        <ErrorBanner
          message={errorMessage(dates.error, t)}
          onRetry={() => dates.refetch()}
          retryLabel={t.retry}
        />
      ) : dates.data.upcoming.length === 0 ? (
        <EmptyState text={t.noDates} />
      ) : (
        dates.data.upcoming.map((u) => (
          <Card key={u.importantDate.id} onPress={() => router.push(`/date/${u.importantDate.id}`)}>
            <Text style={s.muted}>{t[`type${u.importantDate.type}`]}</Text>
            <Text style={s.title}>{u.importantDate.title}</Text>
            <Text style={s.body}>{detail(u)}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
