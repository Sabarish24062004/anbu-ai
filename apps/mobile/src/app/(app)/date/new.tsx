import type { CreateImportantDateInput } from '@anbu/shared';
import { ImportantDateForm } from '@/components/forms/ImportantDateForm';
import { Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useInvalidatingMutation } from '@/lib/queries';
import { goBack } from '@/lib/navigation';

export default function NewImportantDateScreen() {
  const create = useInvalidatingMutation(
    ({ input, key }: { input: CreateImportantDateInput; key: string }) =>
      api.createImportantDate(input, key),
    [keys.dates],
  );
  return (
    <Screen>
      <ImportantDateForm
        submit={(input, key) => create.mutateAsync({ input, key })}
        onSaved={() => goBack('/dates')}
      />
    </Screen>
  );
}
