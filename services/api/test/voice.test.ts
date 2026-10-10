import request from 'supertest';
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiTranscriber } from '../src/modules/assistant/llm/gemini';
import { LlmError, type Transcriber } from '../src/modules/assistant/llm/types';
import { callTool, say, scriptedLlm } from './fake-llm';
import { buildTestApp, deleteTestUsers, registerUser } from './helpers';

let heard = '';
const transcriber: Transcriber = {
  name: 'fake',
  transcribe: vi.fn(async () => heard),
};
const fake = scriptedLlm((ctx) =>
  ctx.call === 0 && ctx.userText.includes('உடற்பயிற்சி')
    ? callTool('create_event', { title: 'உடற்பயிற்சி', startAt: '2027-09-01T07:00' })
    : say('சரி'),
);
const { app, prisma } = buildTestApp({ llm: fake.provider, transcriber });
let user: Awaited<ReturnType<typeof registerUser>>;

// ~150 KB of base64: larger than the 100 KB limit on every other route.
const AUDIO = Buffer.alloc(110_000, 7).toString('base64');

beforeAll(async () => {
  user = await registerUser(app);
});
afterAll(async () => {
  await deleteTestUsers(prisma);
  await prisma.$disconnect();
});
afterEach(() => vi.unstubAllGlobals());

const sendVoice = (body: Record<string, unknown>) =>
  request(app).post('/assistant/voice').set(user.auth).send(body);

describe('POST /assistant/voice', () => {
  it('transcribes speech and handles it like a typed message', async () => {
    heard = '1 செப்டம்பர் 2027 காலை 7 மணிக்கு உடற்பயிற்சி சேர்';
    const res = await sendVoice({ audio: AUDIO, mimeType: 'audio/mp4' });
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe(heard);
    expect(res.body.userMessage.text).toBe(heard);
    expect(res.body.userMessage.language).toBe('ta');
    expect(res.body.reply.actions[0]).toMatchObject({ kind: 'event.created' });
    // audio/mp4 is passed to Gemini under the MIME type it documents.
    expect(transcriber.transcribe).toHaveBeenCalledWith({ base64: AUDIO, mimeType: 'audio/m4a' });
  });

  it('says so when no words were heard, and stores nothing', async () => {
    heard = '   ';
    const before = await prisma.conversationMessage.count({ where: { userId: user.userId } });
    const res = await sendVoice({ audio: AUDIO, mimeType: 'audio/m4a' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SPEECH');
    expect(await prisma.conversationMessage.count({ where: { userId: user.userId } })).toBe(before);
  });

  it('validates the upload', async () => {
    expect(
      (await sendVoice({ audio: 'not base64!!'.repeat(20), mimeType: 'audio/m4a' })).status,
    ).toBe(400);
    expect((await sendVoice({ audio: AUDIO, mimeType: 'video/mp4' })).status).toBe(400);
    const tooLong = Buffer.alloc(2.5 * 1024 * 1024).toString('base64');
    expect((await sendVoice({ audio: tooLong, mimeType: 'audio/m4a' })).status).toBe(413);
  });

  it('keeps the small body limit on every other route', async () => {
    const res = await request(app)
      .post('/assistant/messages')
      .set(user.auth)
      .send({ text: 'x', padding: AUDIO });
    expect(res.status).toBe(413);
  });

  it('maps transcription rate limits to ASSISTANT_BUSY', async () => {
    vi.mocked(transcriber.transcribe).mockRejectedValueOnce(new LlmError('quota', 'rate_limited'));
    const res = await sendVoice({ audio: AUDIO, mimeType: 'audio/m4a' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ASSISTANT_BUSY');
  });

  it('reports voice as unavailable without a transcriber', async () => {
    const plain = buildTestApp({ llm: fake.provider });
    try {
      const status = await request(plain.app).get('/assistant/status').set(user.auth);
      expect(status.body).toEqual({ available: true, voice: false });
      const res = await request(plain.app)
        .post('/assistant/voice')
        .set(user.auth)
        .send({ audio: AUDIO, mimeType: 'audio/m4a' });
      expect(res.status).toBe(503);
    } finally {
      await plain.prisma.$disconnect();
    }
  });
});

describe('Gemini transcriber', () => {
  it('sends the audio inline with a transcription instruction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: ' நாளை கூட்டம் ' }] }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const t = createGeminiTranscriber({ apiKey: 'k', model: 'gemini-test' });
    expect(await t.transcribe({ base64: 'QUJD', mimeType: 'audio/m4a' })).toBe('நாளை கூட்டம்');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.store).toBe(false);
    expect(body.input[0].content[1]).toEqual({
      type: 'audio',
      data: 'QUJD',
      mime_type: 'audio/m4a',
    });
    expect(body.input[0].content[0].text).toMatch(/Tamil script/);
  });
});
