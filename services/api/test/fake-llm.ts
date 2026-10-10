import type {
  ChatTurn,
  LlmOutput,
  LlmProvider,
  ToolResult,
  ToolSpec,
} from '../src/modules/assistant/llm/types';

export interface TurnContext {
  system: string;
  history: ChatTurn[];
  userText: string;
  tools: ToolSpec[];
  /** Tool results sent with this model call (empty on the first call of a turn). */
  results: ToolResult[];
  /** 0 for the first model call of the turn, 1 after the first tool results, … */
  call: number;
}

/**
 * A deterministic stand-in for the model: `script` decides each response from what it was sent.
 * Every request is recorded so tests can assert on prompts and tool results.
 */
export function scriptedLlm(script: (ctx: TurnContext) => LlmOutput | Promise<LlmOutput>) {
  const calls: TurnContext[] = [];
  const provider: LlmProvider = {
    name: 'fake',
    startTurn({ system, history, userText, tools }) {
      let call = 0;
      return {
        async next(results?: ToolResult[]) {
          const ctx = { system, history, userText, tools, results: results ?? [], call: call++ };
          calls.push(ctx);
          return script(ctx);
        },
      };
    },
  };
  return { provider, calls };
}

export const say = (text: string): LlmOutput => ({ text, toolCalls: [] });

let n = 0;
export const callTool = (name: string, args: unknown): LlmOutput => ({
  text: null,
  toolCalls: [{ id: `call-${++n}`, name, args }],
});

export const parsedResult = (ctx: TurnContext, i = 0) =>
  JSON.parse(ctx.results[i]?.content ?? 'null') as Record<string, unknown>;
