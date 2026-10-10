import { router } from 'expo-router';
import { Text, View } from 'react-native';
import type { ReminderDto } from '@anbu/shared';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { pathFor, reminderBody } from '@/lib/notifications';
import { keys, useDueReminders, useInvalidatingMutation } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { Button, Card, ErrorBanner, useStyles } from './ui';

const SNOOZE_MINUTES = 10;

/** Reminders that have gone off and still need a response, shown at the top of the agenda. */
export function DueReminders() {
  const s = useStyles();
  const t = useT();
  const { language } = useSession();
  const due = useDueReminders();
  const ack = useInvalidatingMutation((id: string) => api.acknowledgeReminder(id, 'DISMISSED'), []);
  const snooze = useInvalidatingMutation(
    (id: string) => api.snoozeReminder(id, SNOOZE_MINUTES),
    [],
  );
  const completeTask = useInvalidatingMutation(
    async (r: ReminderDto) => {
      await api.completeTask(r.source.id);
      await api.acknowledgeReminder(r.id, 'COMPLETED');
    },
    [keys.tasks],
  );
  const failed = ack.error ?? snooze.error ?? completeTask.error;
  const reminders = due.data?.reminders ?? [];
  if (!reminders.length && !failed) return null;

  return (
    <View style={{ gap: 8 }}>
      <Text style={s.section} accessibilityRole="header">
        {t.dueNow}
      </Text>
      {failed && <ErrorBanner message={errorMessage(failed, t)} />}
      {reminders.map((r) => (
        <Card key={r.id} onPress={() => router.push(pathFor(r) as never)}>
          <Text style={s.title}>{r.source.title}</Text>
          <Text style={s.muted}>{reminderBody(r, t, language)}</Text>
          <View style={[s.row, { marginTop: 8, flexWrap: 'wrap' }]}>
            {r.source.type === 'task' && (
              <Button
                label={t.markDone}
                onPress={() => completeTask.mutate(r)}
                loading={completeTask.isPending && completeTask.variables?.id === r.id}
              />
            )}
            <Button
              label={t.snooze(SNOOZE_MINUTES)}
              variant="secondary"
              onPress={() => snooze.mutate(r.id)}
              loading={snooze.isPending && snooze.variables === r.id}
            />
            <Button
              label={t.gotIt}
              variant="secondary"
              onPress={() => ack.mutate(r.id)}
              loading={ack.isPending && ack.variables === r.id}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}
