import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  IMPORTANT_DATE_TYPES,
  type CreateImportantDateInput,
  type ImportantDateDto,
  type ImportantDateType,
} from '@anbu/shared';
import { DateTimeField } from '@/components/DateTimeField';
import { Button, Choice, ErrorBanner, SwitchRow, TextField } from '@/components/ui';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useSession, useT } from '@/lib/session-context';

/** Seed for the picker; an unknown year uses a leap year so Feb 29 is representable. */
function initialDate(d?: ImportantDateDto): Date {
  if (!d) return new Date();
  const year = d.year ?? (d.month === 2 && d.day === 29 ? 2000 : new Date().getFullYear());
  return new Date(year, d.month - 1, d.day);
}

export function ImportantDateForm({
  initial,
  submit,
  onSaved,
}: {
  initial?: ImportantDateDto;
  submit: (input: CreateImportantDateInput, idempotencyKey: string) => Promise<unknown>;
  onSaved: () => void;
}) {
  const t = useT();
  const { language } = useSession();
  const keyFor = useIdempotencyKey();

  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<ImportantDateType>(initial?.type ?? 'BIRTHDAY');
  const [date, setDate] = useState(() => initialDate(initial));
  const [knowYear, setKnowYear] = useState(initial ? initial.year != null : false);
  const [personName, setPersonName] = useState(initial?.personName ?? '');
  const [relationship, setRelationship] = useState(initial?.relationship ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const buildInput = (): CreateImportantDateInput => ({
    title: title.trim(),
    type,
    month: date.getMonth() + 1,
    day: date.getDate(),
    year: knowYear ? date.getFullYear() : null,
    personName: personName.trim() || null,
    relationship: relationship.trim() || null,
    notes: notes.trim() || null,
  });

  const save = useMutation({
    mutationFn: (input: CreateImportantDateInput) => submit(input, keyFor(input)),
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
      <Choice
        label={t.type}
        value={type}
        onChange={setType}
        options={IMPORTANT_DATE_TYPES.map((v) => ({ value: v, label: t[`type${v}`] }))}
      />
      <DateTimeField
        label={t.date}
        value={date}
        onChange={setDate}
        mode="date"
        language={language}
        error={errors.day ?? errors.year}
      />
      <SwitchRow label={t.knowYear} value={knowYear} onChange={setKnowYear} />
      <TextField label={t.personName} value={personName} onChangeText={setPersonName} />
      <TextField label={t.relationship} value={relationship} onChangeText={setRelationship} />
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
