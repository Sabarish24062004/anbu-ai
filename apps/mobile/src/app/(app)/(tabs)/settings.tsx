import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';
import {
  REMINDER_LEAD_OPTIONS_MINUTES,
  isValidTimezone,
  type MeResponse,
  type Language,
} from '@anbu/shared';
import {
  Button,
  Card,
  Choice,
  ErrorBanner,
  Loading,
  Screen,
  TextField,
  useStyles,
} from '@/components/ui';
import { api, fetchHealth } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/config';
import { deviceTimezone } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { ApiError } from '@/lib/http';
import { getPermission, requestPermission, type PermissionState } from '@/lib/notifications';
import { keys, useMe } from '@/lib/queries';
import { sessionStore } from '@/lib/session';
import { useSession, useT } from '@/lib/session-context';
import { useColors } from '@/theme/colors';

export default function SettingsScreen() {
  const s = useStyles();
  const t = useT();
  const { session, signOut } = useSession();
  const queryClient = useQueryClient();
  const me = useMe();
  const [saveError, setSaveError] = useState<unknown>(null);

  /** Applies a profile/preferences change and updates the cached user (and UI language). */
  const apply = async (change: () => Promise<MeResponse>) => {
    setSaveError(null);
    try {
      const next = await change();
      queryClient.setQueryData(keys.me, next);
      await sessionStore.setUser(next.user);
    } catch (e) {
      setSaveError(e);
    }
  };

  const phoneTz = deviceTimezone();
  const tzDiffers =
    !!me.data && !!phoneTz && isValidTimezone(phoneTz) && phoneTz !== me.data.user.timezone;

  return (
    <Screen refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      {me.isPending ? (
        <Loading />
      ) : me.isError ? (
        <ErrorBanner
          message={errorMessage(me.error, t)}
          onRetry={() => me.refetch()}
          retryLabel={t.retry}
        />
      ) : (
        <>
          <Text style={s.section} accessibilityRole="header">
            {t.profile}
          </Text>
          <Text style={s.muted}>{session?.user.email}</Text>
          <NameField
            // Re-mounts with the saved value whenever the server's copy changes.
            key={me.data.user.displayName ?? ''}
            saved={me.data.user.displayName ?? ''}
            onSave={(displayName) => void apply(() => api.updateMe({ displayName }))}
          />
          <Choice<Language>
            label={t.language}
            value={me.data.user.language}
            onChange={(language) => void apply(() => api.updateMe({ language }))}
            options={[
              { value: 'ta', label: 'தமிழ்' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Choice
            label={t.defaultReminder}
            value={me.data.preferences.defaultReminderLeadMinutes}
            onChange={(m) =>
              void apply(() => api.updatePreferences({ defaultReminderLeadMinutes: m }))
            }
            options={REMINDER_LEAD_OPTIONS_MINUTES.map((m) => ({
              value: m,
              label: t.minutesBefore(m),
            }))}
          />
          <View style={{ gap: 6 }}>
            <Text style={s.label}>{t.timezone}</Text>
            <Text style={s.body}>{me.data.user.timezone}</Text>
            {tzDiffers && (
              <Button
                label={phoneTz!}
                variant="secondary"
                onPress={() => void apply(() => api.updateMe({ timezone: phoneTz }))}
              />
            )}
          </View>
          {saveError ? <ErrorBanner message={errorMessage(saveError, t)} /> : null}
        </>
      )}

      <NotificationStatus />
      <ServerStatus />
      <Button label={t.signOut} variant="danger" onPress={() => void signOut()} />
    </Screen>
  );
}

function NameField({ saved, onSave }: { saved: string; onSave: (name: string | null) => void }) {
  const t = useT();
  const [name, setName] = useState(saved);
  return (
    <TextField
      label={t.displayName}
      value={name}
      onChangeText={setName}
      onEndEditing={() => {
        const trimmed = name.trim();
        if (trimmed !== saved) onSave(trimmed || null);
      }}
    />
  );
}

function NotificationStatus() {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const [state, setState] = useState<PermissionState | null>(null);

  // Re-check when the screen regains focus: the user may have changed it in phone settings.
  useFocusEffect(
    useCallback(() => {
      void getPermission().then(setState);
    }, []),
  );

  if (Platform.OS === 'web' || state === null) return null;
  const on = state === 'granted';
  return (
    <Card>
      <Text style={s.title}>{t.notifications}</Text>
      <Text style={{ color: on ? colors.success : colors.warning, fontSize: 15, lineHeight: 21 }}>
        {on ? t.notificationsOn : t.notificationsOff}
      </Text>
      {!on && (
        <View style={{ marginTop: 8 }}>
          <Button
            label={state === 'denied' ? t.openSettings : t.enableNotifications}
            variant="secondary"
            onPress={() =>
              state === 'denied'
                ? void Linking.openSettings()
                : void requestPermission().then(setState)
            }
          />
        </View>
      )}
    </Card>
  );
}

function ServerStatus() {
  const s = useStyles();
  const t = useT();
  const colors = useColors();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: 1 });

  let text: string;
  let color = colors.textMuted;
  if (health.isPending) {
    text = t.checking;
  } else if (health.isError) {
    const err = health.error;
    text =
      err instanceof ApiError && (err.kind === 'network' || err.kind === 'timeout')
        ? t.errorNetwork
        : t.errorGeneric;
    color = colors.danger;
  } else if (health.data.status === 'ok') {
    text = t.connected(health.data.version);
    color = colors.success;
  } else {
    text = t.dbDown;
    color = colors.warning;
  }

  return (
    <Card>
      <Text style={s.title}>{t.serverStatus}</Text>
      <View style={[s.row, { marginVertical: 6 }]} accessible accessibilityLabel={text}>
        {health.isFetching && <ActivityIndicator color={colors.primary} />}
        <Text style={{ color, fontSize: 15, lineHeight: 21, flexShrink: 1 }}>{text}</Text>
      </View>
      <Text style={s.muted}>{getApiBaseUrl()}</Text>
      <View style={{ marginTop: 8 }}>
        <Button
          label={t.checkAgain}
          variant="secondary"
          onPress={() => void health.refetch()}
          disabled={health.isFetching}
        />
      </View>
    </Card>
  );
}
