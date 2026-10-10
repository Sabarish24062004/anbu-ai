import { router, useLocalSearchParams } from 'expo-router';
import type { CreateImportantDateInput } from '@anbu/shared';
import { ImportantDateForm } from '@/components/forms/ImportantDateForm';
import { Button, ErrorBanner, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage } from '@/lib/errors';
import { keys, useImportantDate, useInvalidatingMutation } from '@/lib/queries';
import { useT } from '@/lib/session-context';

export default function EditImportantDateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const query = useImportantDate(id);
  const update = useInvalidatingMutation(
    ({ input, key }: { input: CreateImportantDateInput; key: string }) =>
      api.updateImportantDate(id, input, key),
    [keys.dates],
  );
  const remove = useInvalidatingMutation(
    () => api.deleteImportantDate(id),
    [keys.dates],
    () => router.back(),
  );

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

  return (
    <Screen>
      <ImportantDateForm
        initial={query.data.importantDate}
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
