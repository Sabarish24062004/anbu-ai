import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useColors, type Colors } from '@/theme/colors';

export function useStyles() {
  return makeStyles(useColors());
}

export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const s = useStyles();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={s.screen}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const s = useStyles();
  const colors = useColors();
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.buttonSecondary,
        variant === 'danger' && s.buttonDanger,
        (pressed || inactive) && s.pressed,
      ]}
    >
      {loading && (
        <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.primary} />
      )}
      <Text
        style={[
          s.buttonText,
          variant === 'secondary' && s.buttonTextSecondary,
          variant === 'danger' && s.buttonTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function TextField({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string }) {
  const s = useStyles();
  const colors = useColors();
  return (
    <Field label={label} error={error}>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[s.input, error ? s.inputError : null, input.multiline ? s.multiline : null]}
        {...input}
      />
    </Field>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const s = useStyles();
  const colors = useColors();
  return (
    <View style={s.switchRow}>
      <Text style={s.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}

/** A row of mutually exclusive choices; wraps on narrow screens. */
export function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const s = useStyles();
  return (
    <Field label={label}>
      <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[s.chip, selected && s.chipSelected]}
            >
              <Text style={[s.chipText, selected && s.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const s = useStyles();
  if (!onPress) return <View style={s.card}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      {children}
    </Pressable>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const s = useStyles();
  return (
    <View style={s.errorBanner} accessibilityRole="alert">
      <Text style={s.errorText}>{message}</Text>
      {onRetry && retryLabel ? (
        <Button label={retryLabel} onPress={onRetry} variant="secondary" />
      ) : null}
    </View>
  );
}

export function Loading() {
  const colors = useColors();
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  const s = useStyles();
  return <Text style={s.empty}>{text}</Text>;
}

export const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { padding: 16, gap: 12, paddingBottom: 48 },
    button: {
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primary,
    },
    buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
    buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.danger },
    buttonText: { color: c.onPrimary, fontSize: 16, fontWeight: '600' },
    buttonTextSecondary: { color: c.text },
    buttonTextDanger: { color: c.danger },
    pressed: { opacity: 0.6 },
    field: { gap: 6 },
    label: { fontSize: 14, fontWeight: '600', color: c.textMuted },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
    },
    inputError: { borderColor: c.danger },
    multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
    fieldError: { color: c.danger, fontSize: 13 },
    switchRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    switchLabel: { fontSize: 16, color: c.text, flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 40,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      backgroundColor: c.surface,
    },
    chipSelected: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 15, color: c.text },
    chipTextSelected: { color: c.onPrimary, fontWeight: '600' },
    card: {
      padding: 14,
      gap: 4,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    errorBanner: {
      padding: 14,
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.danger,
      backgroundColor: c.surface,
    },
    errorText: { color: c.danger, fontSize: 15, lineHeight: 21 },
    empty: { color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', padding: 24 },
    title: { fontSize: 17, fontWeight: '600', color: c.text },
    body: { fontSize: 15, color: c.text, lineHeight: 21 },
    muted: { fontSize: 14, color: c.textMuted },
    section: { fontSize: 15, fontWeight: '700', color: c.textMuted, marginTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  });
