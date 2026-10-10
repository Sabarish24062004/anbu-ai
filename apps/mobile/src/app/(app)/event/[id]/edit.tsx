import { router, useLocalSearchParams } from 'expo-router';
import { EventForm } from '@/components/forms/EventForm';
import { ErrorBanner, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { keys, useEvent, useInvalidatingMutation } from '@/lib/queries';
import { useT } from '@/lib/session-context';

export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const event = useEvent(id);
  const update = useInvalidatingMutation(
    ({ input, key }: { input: Parameters<typeof api.updateEvent>[1]; key: string }) =>
      api.updateEvent(id, input, key),
    [keys.events],
  );

  return (
    <Screen>
      {event.isPending ? (
        <Loading />
      ) : event.isError ? (
        <ErrorBanner message={errorMessage(event.error, t)} />
      ) : (
        <EventForm
          initial={event.data.event}
          submit={(input, key) => update.mutateAsync({ input, key })}
          onSaved={() => router.back()}
        />
      )}
    </Screen>
  );
}
