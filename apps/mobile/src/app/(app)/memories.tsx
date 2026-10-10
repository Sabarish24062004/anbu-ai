import { useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { Button, Card, EmptyState, ErrorBanner, Loading, Screen, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage } from '@/lib/errors';
import { keys, useInvalidatingMutation, useMemories } from '@/lib/queries';
import { useT } from '@/lib/session-context';

/** Everything the assistant remembers, with a way to forget any of it. */
export default function MemoriesScreen() {
  const s = useStyles();
  const t = useT();
  const queryClient = useQueryClient();
  const memories = useMemories();
  const forget = useInvalidatingMutation((id: string) => api.deleteMemory(id), [keys.memories]);
  const forgetAll = useInvalidatingMutation(() => api.deleteAllMemories(), [keys.memories]);
  const failed = forget.error ?? forgetAll.error;

  return (
    <Screen
      refreshing={memories.isRefetching}
      onRefresh={() => void queryClient.invalidateQueries({ queryKey: keys.memories })}
    >
      {failed && <ErrorBanner message={errorMessage(failed, t)} />}
      {memories.isPending ? (
        <Loading />
      ) : memories.isError ? (
        <ErrorBanner
          message={errorMessage(memories.error, t)}
          onRetry={() => memories.refetch()}
          retryLabel={t.retry}
        />
      ) : memories.data.memories.length === 0 ? (
        <EmptyState text={t.noMemories} />
      ) : (
        <>
          {memories.data.memories.map((m) => (
            <Card key={m.id}>
              <View style={[s.row, { alignItems: 'flex-start' }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.body}>{m.value}</Text>
                  <Text style={s.muted}>{m.key.replace(/_/g, ' ')}</Text>
                </View>
                <Button
                  label={t.forget}
                  variant="secondary"
                  onPress={() => forget.mutate(m.id)}
                  loading={forget.isPending && forget.variables === m.id}
                />
              </View>
            </Card>
          ))}
          <Button
            label={t.forgetAll}
            variant="danger"
            loading={forgetAll.isPending}
            onPress={async () => {
              const ok = await confirm({
                title: t.forgetAll,
                message: t.forgetAllConfirm,
                confirmLabel: t.forgetAll,
                cancelLabel: t.keep,
                destructive: true,
              });
              if (ok) forgetAll.mutate(undefined);
            }}
          />
        </>
      )}
    </Screen>
  );
}
