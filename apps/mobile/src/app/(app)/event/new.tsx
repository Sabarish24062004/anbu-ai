import { router } from 'expo-router';
import { EventForm } from '@/components/forms/EventForm';
import { Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useInvalidatingMutation } from '@/lib/queries';

export default function NewEventScreen() {
  const create = useInvalidatingMutation(
    ({ input, key }: { input: Parameters<typeof api.createEvent>[0]; key: string }) =>
      api.createEvent(input, key),
    [keys.events],
  );
  return (
    <Screen>
      <EventForm
        submit={(input, key) => create.mutateAsync({ input, key })}
        onSaved={() => router.back()}
      />
    </Screen>
  );
}
