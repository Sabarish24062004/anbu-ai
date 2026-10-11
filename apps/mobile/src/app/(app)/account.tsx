import { useMutation } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Text } from 'react-native';
import { Button, Card, ErrorBanner, Screen, TextField, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { confirm, errorMessage } from '@/lib/errors';
import { sessionStore } from '@/lib/session';
import { useSession, useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

/** Change password, download all data, delete the account. */
export default function AccountScreen() {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const { signOut } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: async (auth) => {
      await sessionStore.signIn(auth); // fresh tokens: the old ones were revoked
      setCurrent('');
      setNext('');
    },
  });

  const exportData = useMutation({
    mutationFn: async () => {
      const data = await api.exportAccount();
      const json = JSON.stringify(data, null, 2);
      const name = `anbu-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
      const file = new File(Paths.cache, name);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: t.exportData,
        UTI: 'public.json',
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(deletePassword),
    onSuccess: () => signOut(),
  });

  return (
    <Screen>
      <Card>
        <Text style={s.title}>{t.changePassword}</Text>
        <TextField
          label={t.currentPassword}
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
        />
        <TextField
          label={t.newPassword}
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
          placeholder={t.passwordHint}
        />
        {change.isError && <ErrorBanner message={errorMessage(change.error, t)} />}
        {change.isSuccess && <Text style={{ color: colors.success }}>{t.passwordChanged}</Text>}
        <Button
          label={t.changePassword}
          onPress={() => change.mutate()}
          loading={change.isPending}
          disabled={!current || next.length < 8}
        />
      </Card>

      <Card>
        <Text style={s.title}>{t.exportData}</Text>
        <Text style={s.muted}>{t.exportHint}</Text>
        {exportData.isError && <ErrorBanner message={errorMessage(exportData.error, t)} />}
        <Button
          label={t.exportData}
          variant="secondary"
          onPress={() => exportData.mutate()}
          loading={exportData.isPending}
        />
      </Card>

      <Card>
        <Text style={[s.title, { color: colors.danger }]}>{t.deleteAccount}</Text>
        <Text style={s.body}>{t.deleteAccountWarning}</Text>
        <TextField
          label={t.confirmWithPassword}
          value={deletePassword}
          onChangeText={setDeletePassword}
          secureTextEntry
          autoComplete="current-password"
        />
        {remove.isError && <ErrorBanner message={errorMessage(remove.error, t)} />}
        <Button
          label={t.deleteAccount}
          variant="danger"
          loading={remove.isPending}
          disabled={!deletePassword}
          onPress={async () => {
            const ok = await confirm({
              title: t.deleteAccount,
              message: t.deleteAccountWarning,
              confirmLabel: t.delete,
              cancelLabel: t.keep,
              destructive: true,
            });
            if (ok) remove.mutate();
          }}
        />
      </Card>
    </Screen>
  );
}
