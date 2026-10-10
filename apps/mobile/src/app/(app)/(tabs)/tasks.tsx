import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import type { TaskDto } from '@anbu/shared';
import { Button, Card, EmptyState, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { keys, useInvalidatingMutation, useTasks } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

export default function TasksScreen() {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const { language } = useSession();
  const tasks = useTasks();
  const complete = useInvalidatingMutation((id: string) => api.completeTask(id), [keys.tasks]);

  const onComplete = (task: TaskDto) =>
    complete.mutate(task.id, {
      onSuccess: (res) => {
        if (res.rescheduled && res.task.dueAt) {
          const msg = t.nextDue(formatDate(res.task.dueAt, language));
          if (Platform.OS === 'web') globalThis.alert?.(msg);
          else Alert.alert(task.title, msg);
        }
      },
    });

  // Compared with when the list was fetched, so rendering stays pure; refreshing updates it.
  const isOverdue = (task: TaskDto) => !!task.dueAt && Date.parse(task.dueAt) < tasks.dataUpdatedAt;

  return (
    <Screen refreshing={tasks.isRefetching} onRefresh={() => void tasks.refetch()}>
      <Button label={t.addTask} onPress={() => router.push('/task/new')} />
      {complete.isError && <ErrorBanner message={errorMessage(complete.error, t)} />}
      {tasks.isPending ? (
        <Loading />
      ) : tasks.isError ? (
        <ErrorBanner
          message={errorMessage(tasks.error, t)}
          onRetry={() => tasks.refetch()}
          retryLabel={t.retry}
        />
      ) : tasks.data.tasks.length === 0 ? (
        <EmptyState text={t.noTasks} />
      ) : (
        tasks.data.tasks.map((task) => (
          <Card key={task.id} onPress={() => router.push(`/task/${task.id}`)}>
            <View style={s.row}>
              <Pressable
                onPress={() => onComplete(task)}
                disabled={complete.isPending}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: false }}
                accessibilityLabel={`${t.markDone}: ${task.title}`}
                hitSlop={12}
              >
                <Ionicons name="ellipse-outline" size={28} color={colors.primary} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.title}>{task.title}</Text>
                {task.dueAt ? (
                  <Text style={[s.muted, isOverdue(task) && { color: colors.danger }]}>
                    {isOverdue(task) ? `${t.overdue} · ` : ''}
                    {formatDate(task.dueAt, language)} · {formatTime(task.dueAt, language)}
                    {task.rrule ? ' · ↻' : ''}
                  </Text>
                ) : null}
              </View>
              {task.priority === 'HIGH' || task.priority === 'URGENT' ? (
                <Text style={[s.muted, { color: colors.warning, fontWeight: '700' }]}>
                  {t[`priority${task.priority}`]}
                </Text>
              ) : null}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
