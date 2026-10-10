import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';
import {
  REMINDER_LEAD_OPTIONS_MINUTES,
  type CreateEventInput,
  type EventDto,
  type EventMutationResponse,
} from '@anbu/shared';
import { DateTimeField } from '@/components/DateTimeField';
import { Button, Choice, ErrorBanner, SwitchRow, TextField, useStyles } from '@/components/ui';
import {
  formatDate,
  formatTime,
  nextQuarterHour,
  toLocalDateString,
  toLocalDateTimeString,
  wallToLocalDate,
} from '@/lib/datetime';
import { confirm, errorMessage, fieldErrors, scheduleConflicts } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useMe } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';

type Repeat = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const freqOf = (rrule: string | null | undefined): Repeat =>
  (/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(rrule ?? '')?.[1] as Repeat | undefined) ?? 'NONE';

export function EventForm({
  initial,
  submit,
  onSaved,
}: {
  initial?: EventDto;
  submit: (input: CreateEventInput, idempotencyKey: string) => Promise<EventMutationResponse>;
  onSaved: (res: EventMutationResponse) => void;
}) {
  const s = useStyles();
  const t = useT();
  const { language } = useSession();
  const me = useMe();
  const keyFor = useIdempotencyKey();

  const defaultLead = me.data?.preferences.defaultReminderLeadMinutes ?? 15;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [start, setStart] = useState(() =>
    initial ? wallToLocalDate(initial.startAt) : nextQuarterHour(),
  );
  // All-day events store an exclusive end (next midnight); the form shows the last day.
  const [end, setEnd] = useState(() => {
    if (!initial?.endAt) return new Date(start.getTime() + 60 * 60_000);
    const e = wallToLocalDate(initial.endAt);
    if (initial.allDay) e.setDate(e.getDate() - 1);
    return e;
  });
  const [hasEnd, setHasEnd] = useState(initial ? !!initial.endAt && !initial.allDay : true);
  const [repeat, setRepeat] = useState<Repeat>(freqOf(initial?.rrule));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [notes, setNotes] = useState(initial?.description ?? '');
  const [lead, setLead] = useState<number>(initial?.reminderOffsets[0] ?? defaultLead);
  const [travel, setTravel] = useState(String(initial?.travelBufferMinutes ?? 0));

  const buildInput = (): CreateEventInput => {
    const fmt = allDay ? toLocalDateString : toLocalDateTimeString;
    // Keep a richer existing rule (e.g. BYDAY) unless the user picked a different frequency.
    const rrule =
      repeat === 'NONE'
        ? null
        : repeat === freqOf(initial?.rrule)
          ? initial!.rrule
          : `FREQ=${repeat}`;
    return {
      title: title.trim(),
      startAt: fmt(start),
      endAt: allDay ? fmt(end < start ? start : end) : hasEnd ? fmt(end) : null,
      allDay,
      rrule,
      location: location.trim() || null,
      description: notes.trim() || null,
      reminderOffsets: [lead],
      travelBufferMinutes: Math.max(0, Math.min(720, Number.parseInt(travel, 10) || 0)),
    };
  };

  const save = useMutation({
    mutationFn: (input: CreateEventInput) => submit(input, keyFor(input)),
    onSuccess: onSaved,
    onError: async (err, input) => {
      const conflicts = scheduleConflicts(err);
      if (!conflicts) return;
      const list = conflicts
        .slice(0, 5)
        .map(
          (c) => `• ${c.title} — ${formatDate(c.start, language)} ${formatTime(c.start, language)}`,
        )
        .join('\n');
      const ok = await confirm({
        title: t.conflictTitle,
        message: t.conflictBody(list),
        confirmLabel: t.saveAnyway,
        cancelLabel: t.cancel,
      });
      if (ok) save.mutate({ ...input, allowConflicts: true });
    },
  });
  const errors = fieldErrors(save.error);
  const showError = save.isError && !scheduleConflicts(save.error);

  return (
    <>
      <TextField
        label={t.title}
        value={title}
        onChangeText={setTitle}
        error={errors.title}
        autoFocus={!initial}
      />
      <SwitchRow label={t.allDay} value={allDay} onChange={setAllDay} />
      <DateTimeField
        label={t.starts}
        value={start}
        onChange={(d) => {
          // Moving the start keeps the duration, as the API does.
          setEnd(new Date(end.getTime() + (d.getTime() - start.getTime())));
          setStart(d);
        }}
        mode={allDay ? 'date' : 'datetime'}
        language={language}
        error={errors.startAt}
      />
      {!allDay && <SwitchRow label={t.hasEndTime} value={hasEnd} onChange={setHasEnd} />}
      {(allDay || hasEnd) && (
        <DateTimeField
          label={t.ends}
          value={end}
          onChange={setEnd}
          mode={allDay ? 'date' : 'datetime'}
          language={language}
          error={errors.endAt}
        />
      )}
      <Choice
        label={t.repeat}
        value={repeat}
        onChange={setRepeat}
        options={[
          { value: 'NONE', label: t.repeatNone },
          { value: 'DAILY', label: t.repeatDaily },
          { value: 'WEEKLY', label: t.repeatWeekly },
          { value: 'MONTHLY', label: t.repeatMonthly },
          { value: 'YEARLY', label: t.repeatYearly },
        ]}
      />
      {initial?.rrule && <Text style={s.muted}>{t.recurringNote}</Text>}
      <Choice
        label={t.reminder}
        value={lead}
        onChange={setLead}
        options={REMINDER_LEAD_OPTIONS_MINUTES.map((m) => ({
          value: m,
          label: t.minutesBefore(m),
        }))}
      />
      <TextField label={t.location} value={location} onChangeText={setLocation} />
      {!allDay && (
        <TextField
          label={t.travelTime}
          value={travel}
          onChangeText={setTravel}
          keyboardType="number-pad"
          error={errors.travelBufferMinutes}
        />
      )}
      <TextField label={t.notes} value={notes} onChangeText={setNotes} multiline />
      {showError && <ErrorBanner message={errorMessage(save.error, t)} />}
      <Button
        label={save.isPending ? t.saving : t.save}
        onPress={() => save.mutate(buildInput())}
        loading={save.isPending}
        disabled={!title.trim()}
      />
    </>
  );
}
