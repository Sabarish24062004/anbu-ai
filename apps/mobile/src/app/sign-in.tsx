import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthHeader } from '@/components/AuthHeader';
import { ServerAddress } from '@/components/ServerAddress';
import { Button, ErrorBanner, Screen, TextField, useStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useSession, useT } from '@/lib/session-context';

export default function SignInScreen() {
  const s = useStyles();
  const t = useT();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The protected-route guard moves to the app as soon as the session is stored.
  const login = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: signIn,
  });

  return (
    <Screen>
      <AuthHeader />
      <TextField
        label={t.email}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label={t.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => login.mutate()}
      />
      {login.isError && <ErrorBanner message={errorMessage(login.error, t)} />}
      <Button
        label={login.isPending ? t.signingIn : t.signIn}
        onPress={() => login.mutate()}
        loading={login.isPending}
        disabled={!email || !password}
      />
      <Link href="/register" replace style={[s.body, { textAlign: 'center', padding: 12 }]}>
        <Text>{t.noAccount}</Text>
      </Link>
      <ServerAddress />
    </Screen>
  );
}
