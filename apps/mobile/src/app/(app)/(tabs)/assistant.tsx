import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ASSISTANT_MAX_INPUT_CHARS,
  type AssistantActionDto,
  type AssistantMessageDto,
  type AssistantReplyDto,
  type ConversationDto,
  type Language,
} from '@anbu/shared';
import { Button, ErrorBanner, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/datetime';
import { errorMessage } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { keys, useMe } from '@/lib/queries';
import { useSession, useT } from '@/lib/session-context';
import { useColors, type Colors } from '@/theme/colors';
import {
  speak,
  stopSpeaking,
  useVoiceRecorder,
  voiceSupported,
  type RecordingResult,
} from '@/lib/voice';

type TurnInput =
  | { kind: 'text'; conversationId?: string; text: string }
  | { kind: 'voice'; conversationId?: string; recording: RecordingResult };

const CONVERSATION_KEY = ['assistant', 'conversation'] as const;

const pathFor = (a: AssistantActionDto) =>
  a.entityType === 'event'
    ? `/event/${a.entityId}`
    : a.entityType === 'task'
      ? `/task/${a.entityId}`
      : `/date/${a.entityId}`;

export default function AssistantScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const t = useT();
  const { language } = useSession();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKey();
  const scroll = useRef<ScrollView>(null);
  const [text, setText] = useState('');
  const me = useMe();
  const speakReplies = me.data?.preferences.voiceResponsesEnabled ?? true;

  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: api.assistantStatus });
  const conversation = useQuery({
    queryKey: CONVERSATION_KEY,
    queryFn: async () => (await api.latestConversation()).conversation,
  });
  const convo = conversation.data ?? null;

  const update = (fn: (c: ConversationDto | null) => ConversationDto | null) =>
    queryClient.setQueryData<ConversationDto | null>(CONVERSATION_KEY, (c) => fn(c ?? null));

  // Anything the assistant changed must show up in the other tabs and in scheduled reminders.
  const refreshData = (actions: AssistantActionDto[]) => {
    if (!actions.length) return;
    for (const k of [keys.events, keys.tasks, keys.dates, keys.reminders]) {
      void queryClient.invalidateQueries({ queryKey: k });
    }
  };

  const send = useMutation({
    mutationFn: (input: TurnInput): Promise<AssistantReplyDto> => {
      if (input.kind === 'text') {
        const body = { conversationId: input.conversationId, text: input.text };
        return api.sendAssistantMessage(body, keyFor(body));
      }
      const body = {
        conversationId: input.conversationId,
        audio: input.recording.base64,
        mimeType: input.recording.mimeType,
      };
      return api.sendVoiceMessage(body, keyFor(body));
    },
    onSuccess: (res, input) => {
      if (input.kind === 'text') setText('');
      // Spoken questions get spoken answers (if the user has not turned that off).
      if (input.kind === 'voice' && speakReplies) {
        void speak(res.reply.text, res.reply.language ?? language);
      }
      update((c) => ({
        id: res.conversationId,
        messages: [...(c?.id === res.conversationId ? c.messages : []), res.userMessage, res.reply],
        pendingAction: res.pendingAction,
      }));
      refreshData(res.reply.actions);
    },
  });

  const decide = useMutation({
    mutationFn: (decision: 'confirm' | 'decline') =>
      api.decidePending(convo!.id, convo!.pendingAction!.id, decision),
    onSuccess: (res) => {
      update((c) => (c ? { ...c, messages: [...c.messages, res.reply], pendingAction: null } : c));
      refreshData(res.reply.actions);
    },
  });

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    send.mutate({ kind: 'text', conversationId: convo?.id, text: trimmed });
  };

  const sendRecording = (recording: RecordingResult | null) => {
    if (recording) send.mutate({ kind: 'voice', conversationId: convo?.id, recording });
  };
  const recorder = useVoiceRecorder(sendRecording);
  const voiceAvailable = voiceSupported && status.data?.voice === true;

  const unavailable = status.data?.available === false;
  const messages = convo?.messages ?? [];
  const pending = convo?.pendingAction ?? null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.list}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {unavailable && <ErrorBanner message={t.assistantUnavailable} />}
        {conversation.isPending ? (
          <Loading />
        ) : messages.length === 0 ? (
          <Text style={s.hint}>{t.assistantHint}</Text>
        ) : (
          messages.map((m) => (
            <Bubble key={m.id} message={m} styles={s} fallbackLanguage={language} />
          ))
        )}

        {pending && (
          <View style={s.pending} accessibilityRole="alert">
            <Text style={s.pendingText}>{pending.summary}?</Text>
            {pending.conflicts.map((c) => (
              <Text key={`${c.eventId}-${c.start}`} style={s.meta}>
                {t.clashesWith}: {c.title} · {formatDate(c.start, language)}{' '}
                {formatTime(c.start, language)}
              </Text>
            ))}
            <View style={s.row}>
              <Button
                label={t.confirm}
                onPress={() => decide.mutate('confirm')}
                loading={decide.isPending && decide.variables === 'confirm'}
              />
              <Button
                label={t.notNow}
                variant="secondary"
                onPress={() => decide.mutate('decline')}
                loading={decide.isPending && decide.variables === 'decline'}
              />
            </View>
          </View>
        )}

        {send.isPending && (
          <View style={[s.row, { paddingHorizontal: 4 }]} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.primary} />
            <Text style={s.meta}>{t.thinking}</Text>
          </View>
        )}
        {recorder.permission === 'denied' && <ErrorBanner message={t.micDenied} />}
        {(send.error ?? decide.error) && (
          <ErrorBanner message={errorMessage(send.error ?? decide.error, t)} />
        )}
      </ScrollView>

      {recorder.isRecording ? (
        <View style={s.composer} accessibilityLiveRegion="polite">
          <View style={s.recording}>
            <View style={s.recDot} />
            <Text style={s.recText}>{t.listening(recorder.seconds)}</Text>
          </View>
          <Pressable
            onPress={() => void recorder.discard()}
            accessibilityRole="button"
            accessibilityLabel={t.discard}
            style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.secondaryText}>{t.discard}</Text>
          </Pressable>
          <Pressable
            onPress={() => void recorder.finish().then(sendRecording)}
            accessibilityRole="button"
            accessibilityLabel={t.stopAndSend}
            style={({ pressed }) => [s.send, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.sendText}>{t.stopAndSend}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t.assistantPlaceholder}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t.assistantPlaceholder}
            style={s.input}
            multiline
            maxLength={ASSISTANT_MAX_INPUT_CHARS}
            editable={!unavailable}
            onSubmitEditing={submit}
            blurOnSubmit={false}
          />
          {voiceAvailable && !text.trim() ? (
            <Pressable
              onPress={() => void recorder.start()}
              disabled={send.isPending}
              accessibilityRole="button"
              accessibilityLabel={t.speak}
              style={({ pressed }) => [s.mic, (send.isPending || pressed) && { opacity: 0.5 }]}
            >
              <Ionicons name="mic" size={26} color={colors.onPrimary} />
            </Pressable>
          ) : (
            <Pressable
              onPress={submit}
              disabled={!text.trim() || send.isPending || unavailable}
              accessibilityRole="button"
              accessibilityLabel={t.send}
              style={({ pressed }) => [
                s.send,
                (!text.trim() || send.isPending || unavailable || pressed) && { opacity: 0.5 },
              ]}
            >
              <Text style={s.sendText}>{t.send}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={s.footer}>
        <Text style={s.privacy}>{t.assistantPrivacy}</Text>
        {messages.length > 0 && (
          <Pressable
            onPress={() => {
              send.reset();
              void stopSpeaking();
              queryClient.setQueryData(CONVERSATION_KEY, null);
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={s.newChat}>{t.newChat}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  styles: s,
  fallbackLanguage,
}: {
  message: AssistantMessageDto;
  styles: ReturnType<typeof makeStyles>;
  fallbackLanguage: Language;
}) {
  const t = useT();
  const mine = message.role === 'user';
  return (
    <View style={[s.bubble, mine ? s.mine : s.theirs]}>
      <Text style={mine ? s.mineText : s.theirsText}>{message.text}</Text>
      {!mine && voiceSupported && (
        <Pressable
          onPress={() => void speak(message.text, message.language ?? fallbackLanguage)}
          accessibilityRole="button"
          accessibilityLabel={t.readAloud}
          hitSlop={8}
          style={s.speaker}
        >
          <Ionicons name="volume-medium-outline" size={18} style={s.speakerIcon} />
        </Pressable>
      )}
      {message.actions.map((a) => (
        <Pressable
          key={`${a.kind}-${a.entityId}`}
          onPress={() => router.push(pathFor(a) as never)}
          accessibilityRole="link"
          style={s.chip}
        >
          <Text style={s.chipText}>↗ {a.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    list: { padding: 16, gap: 10, flexGrow: 1 },
    hint: { color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center', padding: 24 },
    bubble: { maxWidth: '85%', padding: 12, borderRadius: 16, gap: 6 },
    mine: { alignSelf: 'flex-end', backgroundColor: c.primary, borderBottomRightRadius: 4 },
    theirs: {
      alignSelf: 'flex-start',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: 4,
    },
    mineText: { color: c.onPrimary, fontSize: 16, lineHeight: 23 },
    theirsText: { color: c.text, fontSize: 16, lineHeight: 23 },
    chip: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipText: { color: c.primary, fontSize: 14, fontWeight: '600' },
    pending: {
      padding: 14,
      gap: 8,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.warning,
      backgroundColor: c.surface,
    },
    pendingText: { color: c.text, fontSize: 16, fontWeight: '600', lineHeight: 23 },
    meta: { color: c.textMuted, fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
    input: {
      flex: 1,
      minHeight: 48,
      maxHeight: 140,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 12,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
    },
    send: {
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: 12,
      justifyContent: 'center',
      backgroundColor: c.primary,
    },
    sendText: { color: c.onPrimary, fontSize: 16, fontWeight: '600' },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.background,
    },
    privacy: { flex: 1, color: c.textMuted, fontSize: 12, lineHeight: 16 },
    newChat: { color: c.primary, fontSize: 14, fontWeight: '600' },
    mic: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primary,
    },
    recording: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
    recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.danger },
    recText: { color: c.text, fontSize: 16, fontWeight: '600' },
    secondaryBtn: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: 12,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    secondaryText: { color: c.text, fontSize: 16 },
    speaker: { alignSelf: 'flex-start' },
    speakerIcon: { color: c.textMuted },
  });
