import { router, useLocalSearchParams } from 'expo-router';
import type { CreateTaskInput } from '@anbu/shared';
import { TaskForm } from '@/components/forms/TaskForm';
import { Button, ErrorBanner, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage } from '@/lib/errors';
import { keys, useInvalidatingMutation, useTask } from '@/lib/queries';
import { useT } from '@/lib/session-context';

export default function EditTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const task = useTask(id);
  const update = useInvalidatingMutation(
    ({ input, key }: { input: CreateTaskInput; key: string }) => api.updateTask(id, input, key),
    [keys.tasks],
  );
  const remove = useInvalidatingMutation(
    () => api.deleteTask(id),
    [keys.tasks],
    () => router.back(),
  );

  if (task.isPending)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (task.isError)
    return (
      <Screen>
        <ErrorBanner message={errorMessage(task.error, t)} />
      </Screen>
    );

  return (
    <Screen>
      <TaskForm
        initial={task.data.task}
        submit={(input, key) => update.mutateAsync({ input, key })}
        onSaved={() => router.back()}
      />
      {remove.isError && <ErrorBanner message={errorMessage(remove.error, t)} />}
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
    </Screen>
  );
}
