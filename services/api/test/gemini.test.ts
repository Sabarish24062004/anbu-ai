import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiProvider } from '../src/modules/assistant/llm/gemini';

const tools = [
  {
    name: 'get_agenda',
    description: 'd',
    parameters: { type: 'object', properties: {} },
  },
];

function mockFetch(...responses: { status?: number; body: unknown }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(new Response(JSON.stringify(r.body), { status: r.status ?? 200 }));
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini provider (Interactions API, stateless)', () => {
  it('sends the documented request shape and round-trips a function call', async () => {
    const thought = { type: 'thought', signature: 'sig-123' };
    const fetchMock = mockFetch(
      {
        body: {
          status: 'requires_action',
          steps: [
            thought,
            {
              type: 'function_call',
              id: 'fc1',
              name: 'get_agenda',
              arguments: { from: '2027-01-01' },
            },
          ],
        },
      },
      {
        body: {
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: 'You are free.' }] }],
        },
      },
    );
    const provider = createGeminiProvider({ apiKey: 'k-secret', model: 'gemini-test' });
    const session = provider.startTurn({
      system: 'sys',
      history: [{ role: 'assistant', text: 'earlier' }],
      userText: 'what is on?',
      tools,
    });

    const first = await session.next();
    expect(first.toolCalls).toEqual([
      { id: 'fc1', name: 'get_agenda', args: { from: '2027-01-01' } },
    ]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('k-secret');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'gemini-test',
      system_instruction: 'sys',
      store: false,
      tools: [{ type: 'function', name: 'get_agenda' }],
      input: [
        { type: 'model_output', content: [{ type: 'text', text: 'earlier' }] },
        { type: 'user_input', content: [{ type: 'text', text: 'what is on?' }] },
      ],
    });

    const second = await session.next([
      { callId: 'fc1', name: 'get_agenda', content: '{"occurrences":[]}', isError: false },
    ]);
    expect(second).toEqual({ text: 'You are free.', toolCalls: [] });
    const body2 = JSON.parse(fetchMock.mock.calls[1]![1].body);
    // Model steps (including the thought signature) are echoed back unchanged, then the result.
    expect(body2.input.slice(2)).toEqual([
      thought,
      { type: 'function_call', id: 'fc1', name: 'get_agenda', arguments: { from: '2027-01-01' } },
      {
        type: 'function_result',
        call_id: 'fc1',
        name: 'get_agenda',
        is_error: false,
        result: [{ type: 'text', text: '{"occurrences":[]}' }],
      },
    ]);
  });

  it('maps rate limits and errors without leaking the request', async () => {
    mockFetch({ status: 429, body: { error: { message: 'quota' } } });
    const provider = createGeminiProvider({ apiKey: 'k', model: 'm' });
    await expect(
      provider.startTurn({ system: 's', history: [], userText: 'my secret plans', tools }).next(),
    ).rejects.toMatchObject({ kind: 'rate_limited' });

    mockFetch({ status: 400, body: { error: { message: 'bad schema' } } });
    const err = await provider
      .startTurn({ system: 's', history: [], userText: 'my secret plans', tools })
      .next()
      .catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'unavailable' });
    expect((err as Error).message).not.toContain('secret');
  });
});
