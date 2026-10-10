import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { PRIORITIES, type CreateTaskInput, type Priority, type TaskDto } from '@anbu/shared';
import { DateTimeField } from '@/components/DateTimeField';
import { Button, Choice, ErrorBanner, SwitchRow, TextField } from '@/components/ui';
import { nextQuarterHour, toLocalDateTimeString, wallToLocalDate } from '@/lib/datetime';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useSession, useT } from '@/lib/session-context';

type Repeat = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
const freqOf = (rrule: string | null | undefined): Repeat =>
  (/FREQ=(DAILY|WEEKLY|MONTHLY)/.exec(rrule ?? '')?.[1] as Repeat | undefined) ?? 'NONE';

export function TaskForm({
  initial,
  submit,
  onSaved,
}: {
  initial?: TaskDto;
  submit: (input: CreateTaskInput, idempotencyKey: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const t = useT();
  const { language } = useSession();
  const keyFor = useIdempotencyKey();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [hasDue, setHasDue] = useState(initial ? !!initial.dueAt : false);
  const [due, setDue] = useState(() =>
    initial?.dueAt ? wallToLocalDate(initial.dueAt) : nextQuarterHour(),
  );
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'MEDIUM');
  const [repeat, setRepeat] = useState<Repeat>(freqOf(initial?.rrule));
  const [notes, setNotes] = useState(initial?.description ?? '');

  const buildInput = (): CreateTaskInput => {
    const rrule =
      !hasDue || repeat === 'NONE'
        ? null
        : repeat === freqOf(initial?.rrule)
          ? initial!.rrule
          : `FREQ=${repeat}`;
    return {
      title: title.trim(),
      dueAt: hasDue ? toLocalDateTimeString(due) : null,
      priority,
      rrule,
      description: notes.trim() || null,
    };
  };

  const save = useMutation({
    mutationFn: (input: CreateTaskInput) => submit(input, keyFor(input)),
    onSuccess: onSaved,
  });
  const errors = fieldErrors(save.error);

  return (
    <>
      <TextField
        label={t.title}
        value={title}
        onChangeText={setTitle}
        error={errors.title}
        autoFocus={!initial}
      />
      <SwitchRow label={t.hasDueDate} value={hasDue} onChange={setHasDue} />
      {hasDue && (
        <>
          <DateTimeField
            label={t.due}
            value={due}
            onChange={setDue}
            language={language}
            error={errors.dueAt}
          />
          <Choice
            label={t.repeat}
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: 'NONE', label: t.repeatNone },
              { value: 'DAILY', label: t.repeatDaily },
              { value: 'WEEKLY', label: t.repeatWeekly },
              { value: 'MONTHLY', label: t.repeatMonthly },
            ]}
          />
        </>
      )}
      <Choice
        label={t.priority}
        value={priority}
        onChange={setPriority}
        options={PRIORITIES.map((p) => ({ value: p, label: t[`priority${p}`] }))}
      />
      <TextField label={t.notes} value={notes} onChangeText={setNotes} multiline />
      {save.isError && <ErrorBanner message={errorMessage(save.error, t)} />}
      <Button
        label={save.isPending ? t.saving : t.save}
        onPress={() => save.mutate(buildInput())}
        loading={save.isPending}
        disabled={!title.trim()}
      />
    </>
  );
}
