import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { createElement } from 'react';
import { Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import type { Language } from '@anbu/shared';
import { localeFor, toLocalDateString, toLocalDateTimeString } from '@/lib/datetime';
import { useColors } from '@/theme/colors';
import { Field, useStyles } from './ui';

type Mode = 'date' | 'datetime' | 'time';

function formatLocal(d: Date, mode: Mode, lang: Language) {
  if (mode === 'time') {
    return new Intl.DateTimeFormat(localeFor(lang), { hour: 'numeric', minute: '2-digit' }).format(
      d,
    );
  }
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(mode === 'datetime' ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d);
}

/**
 * Date or date-time picker. Android uses the system dialogs (date, then time), iOS the compact
 * inline picker, and the web the browser's date/time input.
 */
export function DateTimeField({
  label,
  value,
  onChange,
  mode = 'datetime',
  language,
  error,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  mode?: Mode;
  language: Language;
  error?: string;
}) {
  const s = useStyles();
  const colors = useColors();
  const display = formatLocal(value, mode, language);

  if (Platform.OS === 'ios') {
    return (
      <Field label={label} error={error}>
        <View style={{ alignItems: 'flex-start' }}>
          <DateTimePicker
            value={value}
            mode={mode}
            display="compact"
            locale={localeFor(language)}
            onValueChange={(_e, d) => onChange(d)}
            accessibilityLabel={label}
          />
        </View>
      </Field>
    );
  }

  if (Platform.OS === 'android') {
    const open = () => {
      if (mode === 'time') {
        DateTimePickerAndroid.open({
          value,
          mode: 'time',
          onValueChange: (_e, time) => onChange(time),
        });
        return;
      }
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        // onValueChange fires only when a value is picked; dismissing does nothing.
        onValueChange: (_e, date) => {
          if (mode === 'date') return onChange(date);
          DateTimePickerAndroid.open({
            value: date,
            mode: 'time',
            onValueChange: (_e2, time) => onChange(time),
          });
        },
      });
    };
    return (
      <Field label={label} error={error}>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${display}`}
          style={({ pressed }) => [s.input, { justifyContent: 'center' }, pressed && s.pressed]}
        >
          <Text style={{ fontSize: 16, color: colors.text }}>{display}</Text>
        </Pressable>
      </Field>
    );
  }

  return <WebDateTimeInput {...{ label, value, onChange, mode, error }} />;
}

/** The browser's own date/time picker: an HTML <input> (react-native-web renders to the DOM). */
function WebDateTimeInput({
  label,
  value,
  onChange,
  mode,
  error,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  mode: Mode;
  error?: string;
}) {
  const colors = useColors();
  const scheme = useColorScheme();
  const text =
    mode === 'date'
      ? toLocalDateString(value)
      : mode === 'time'
        ? toLocalDateTimeString(value).slice(11)
        : toLocalDateTimeString(value);
  return (
    <Field label={label} error={error}>
      {createElement('input', {
        type: mode === 'date' ? 'date' : mode === 'time' ? 'time' : 'datetime-local',
        value: text,
        'aria-label': label,
        // Fires once a complete value is picked or typed; a cleared field keeps the last value.
        onChange: (e: { target: { value: string } }) => {
          const v = e.target.value;
          if (!v) return;
          const parsed = new Date(
            mode === 'date'
              ? `${v}T00:00`
              : mode === 'time'
                ? `${toLocalDateString(value)}T${v}`
                : v,
          );
          if (!Number.isNaN(parsed.getTime())) onChange(parsed);
        },
        style: {
          minHeight: 48,
          boxSizing: 'border-box',
          width: '100%',
          border: `1px solid ${error ? colors.danger : colors.border}`,
          borderRadius: 10,
          padding: '0 12px',
          fontSize: 16,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: colors.text,
          backgroundColor: colors.surface,
          colorScheme: scheme === 'dark' ? 'dark' : 'light',
        },
      })}
    </Field>
  );
}
