/**
 * Provider-neutral contract for the language model. The assistant service owns the tool loop;
 * a provider only translates between this shape and its own API.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object) for the arguments; keep to the simple subset all providers accept. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  /** Serialised result shown to the model. */
  content: string;
  isError: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface LlmOutput {
  text: string | null;
  toolCalls: ToolCall[];
}

/** One user turn: the first `next()` sends the user's text, later calls send tool results. */
export interface LlmSession {
  next(toolResults?: ToolResult[]): Promise<LlmOutput>;
}

export interface LlmProvider {
  readonly name: string;
  startTurn(req: {
    system: string;
    history: ChatTurn[];
    userText: string;
    tools: ToolSpec[];
  }): LlmSession;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'rate_limited' | 'unavailable' | 'bad_response',
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
