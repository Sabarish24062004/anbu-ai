import { LlmError, type LlmProvider, type LlmSession, type ToolCall } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;

// Steps are passed back exactly as received (stateless mode), including thought steps whose
// signatures the API validates, so they are kept as opaque objects.
type Step = { type: string; [key: string]: unknown };

interface InteractionResponse {
  status?: string;
  steps?: Step[];
  error?: { message?: string };
}

const textStep = (type: 'user_input' | 'model_output', text: string): Step => ({
  type,
  content: [{ type: 'text', text }],
});

/**
 * Gemini via the Interactions API in stateless mode (`store: false`): every request carries the
 * whole turn, so nothing is kept on Google's side between requests beyond what its terms allow.
 */
export function createGeminiProvider(opts: { apiKey: string; model: string }): LlmProvider {
  return {
    name: `gemini:${opts.model}`,
    startTurn({ system, history, userText, tools }): LlmSession {
      const steps: Step[] = [
        ...history.map((t) => textStep(t.role === 'user' ? 'user_input' : 'model_output', t.text)),
        textStep('user_input', userText),
      ];
      const toolDefs = tools.map((t) => ({ type: 'function', ...t }));

      return {
        async next(toolResults) {
          for (const r of toolResults ?? []) {
            steps.push({
              type: 'function_result',
              call_id: r.callId,
              name: r.name,
              is_error: r.isError,
              result: [{ type: 'text', text: r.content }],
            });
          }
          const body = await post(opts.apiKey, {
            model: opts.model,
            system_instruction: system,
            input: steps,
            tools: toolDefs,
            store: false,
            generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
          });
          const produced = newSteps(steps, body.steps ?? []);
          steps.push(...produced);

          if (body.status === 'failed' || body.status === 'cancelled') {
            throw new LlmError(`Interaction ${body.status}`, 'bad_response');
          }
          const toolCalls: ToolCall[] = produced
            .filter((s) => s.type === 'function_call')
            .map((s) => ({ id: String(s['id']), name: String(s['name']), args: s['arguments'] }));
          const text = produced
            .filter((s) => s.type === 'model_output')
            .flatMap((s) => (s['content'] as { type?: string; text?: string }[] | undefined) ?? [])
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('')
            .trim();
          return { text: text || null, toolCalls };
        },
      };
    },
  };
}

/** The response may echo the input steps; only the steps after them are new. */
function newSteps(sent: Step[], received: Step[]): Step[] {
  const echoes =
    received.length > sent.length && sent.every((s, i) => received[i]?.type === s.type);
  return echoes ? received.slice(sent.length) : received;
}

async function post(apiKey: string, payload: unknown): Promise<InteractionResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    throw new LlmError(
      controller.signal.aborted ? 'Model request timed out' : (e as Error).message,
      'unavailable',
    );
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as InteractionResponse | null;
  if (res.status === 429) throw new LlmError('Model rate limit reached', 'rate_limited');
  if (!res.ok || !body) {
    // Never include the request (it holds personal data) or the key in the error.
    throw new LlmError(
      `Model API error ${res.status}: ${body?.error?.message ?? ''}`,
      'unavailable',
    );
  }
  return body;
}
