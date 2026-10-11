import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { fetchHealth } from '@/lib/api';
import { getApiBaseUrl, normalizeServerAddress } from '@/lib/config';
import { errorMessage } from '@/lib/errors';
import { saveServerAddress } from '@/lib/server-address';
import { useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';
import { Button, TextField, useStyles } from './ui';

/**
 * Shows which server the app talks to and lets the user change it. Installed builds need this:
 * unlike Expo Go they cannot find the development PC by themselves.
 */
export function ServerAddress() {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(getApiBaseUrl());
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    try {
      const health = await fetchHealth();
      setStatus({
        ok: health.status === 'ok',
        message: health.status === 'ok' ? t.serverOk : t.dbDown,
      });
    } catch (e) {
      setStatus({ ok: false, message: errorMessage(e, t) });
    }
  };

  const save = async () => {
    const url = normalizeServerAddress(text);
    if (!url) {
      setStatus({ ok: false, message: t.serverInvalid });
      return;
    }
    setBusy(true);
    await saveServerAddress(url);
    setText(url);
    await test();
    void queryClient.invalidateQueries();
    setBusy(false);
    setEditing(false);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{t.serverAddress}</Text>
      {editing ? (
        <>
          <TextField
            label={t.serverAddress}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.5:4000"
          />
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Button label={t.saveAndTest} onPress={() => void save()} loading={busy} />
            <Button label={t.cancel} variant="secondary" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : (
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          <Text style={[s.body, { flexShrink: 1 }]}>{getApiBaseUrl()}</Text>
          <Button
            label={t.change}
            variant="secondary"
            onPress={() => {
              setText(getApiBaseUrl());
              setStatus(null);
              setEditing(true);
            }}
          />
        </View>
      )}
      {status && (
        <Text style={{ color: status.ok ? colors.success : colors.danger, fontSize: 14 }}>
          {status.message}
        </Text>
      )}
    </View>
  );
}
