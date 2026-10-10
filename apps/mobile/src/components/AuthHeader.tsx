import { Text, View } from 'react-native';
import { APP_NAME } from '@/lib/config';
import { useSession, useT } from '@/lib/session-context';
import { Choice, useStyles } from './ui';

/** Greeting and language switch shown above the sign-in and register forms. */
export function AuthHeader() {
  const s = useStyles();
  const t = useT();
  const { language, setLanguage } = useSession();
  return (
    <View style={{ gap: 8, marginTop: 32, marginBottom: 8 }}>
      <Text style={[s.title, { fontSize: 34, lineHeight: 48 }]} accessibilityRole="header">
        {t.greeting}
      </Text>
      <Text style={[s.body, { fontSize: 17 }]}>
        {APP_NAME} · {t.appTagline}
      </Text>
      <Choice
        label={t.language}
        value={language}
        onChange={setLanguage}
        options={[
          { value: 'ta', label: 'தமிழ்' },
          { value: 'en', label: 'English' },
        ]}
      />
    </View>
  );
}
