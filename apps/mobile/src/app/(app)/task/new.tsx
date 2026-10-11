import type { CreateTaskInput } from '@anbu/shared';
import { TaskForm } from '@/components/forms/TaskForm';
import { Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useInvalidatingMutation } from '@/lib/queries';
import { goBack } from '@/lib/navigation';

export default function NewTaskScreen() {
  const create = useInvalidatingMutation(
    ({ input, key }: { input: CreateTaskInput; key: string }) => api.createTask(input, key),
    [keys.tasks],
  );
  return (
    <Screen>
      <TaskForm
        submit={(input, key) => create.mutateAsync({ input, key })}
        onSaved={() => goBack('/tasks')}
      />
    </Screen>
  );
}
