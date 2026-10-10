import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { isValidTimezone } from '@anbu/shared';
import { AuthHeader } from '@/components/AuthHeader';
import { Button, ErrorBanner, Screen, TextField, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { deviceTimezone } from '@/lib/datetime';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { useSession, useT } from '@/lib/session-context';

export default function RegisterScreen() {
  const s = useStyles();
  const t = useT();
  const { signIn, language } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const register = useMutation({
    mutationFn: () => {
      const tz = deviceTimezone();
      return api.register({
        email,
        password,
        displayName: displayName.trim() || undefined,
        language,
        // Schedule in the phone's timezone; the server falls back to its default otherwise.
        timezone: tz && isValidTimezone(tz) ? tz : undefined,
      });
    },
    onSuccess: signIn,
  });
  const errors = fieldErrors(register.error);

  return (
    <Screen>
      <AuthHeader />
      <TextField
        label={t.yourName}
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
        textContentType="name"
      />
      <TextField
        label={t.email}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        error={errors.email}
      />
      <TextField
        label={t.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder={t.passwordHint}
        error={errors.password}
      />
      {register.isError && <ErrorBanner message={errorMessage(register.error, t)} />}
      <Button
        label={register.isPending ? t.creatingAccount : t.createAccount}
        onPress={() => register.mutate()}
        loading={register.isPending}
        disabled={!email || password.length < 8}
      />
      <Link href="/sign-in" replace style={[s.body, { textAlign: 'center', padding: 12 }]}>
        <Text>{t.haveAccount}</Text>
      </Link>
    </Screen>
  );
}
