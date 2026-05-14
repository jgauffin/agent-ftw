/**
 * Test fake for `@anthropic-ai/sdk`. Exposes a tiny subset of the real SDK
 * shape so the `anthropicApiAdapter` paths (`runUntilPhaseEnd` model loop and
 * the one-shot `runStructured` call) can be exercised without network access.
 */

export interface ContentBlock {
  type: string;
  input?: unknown;
  text?: string;
  /** Present on `tool_use` blocks. */
  id?: string;
  /** Present on `tool_use` blocks. */
  name?: string;
}

interface FakeState {
  responses: Array<{ content: ContentBlock[] }>;
  /** Captured `messages.create` call args, in order. */
  calls: Array<{ body: unknown; signal: AbortSignal | undefined }>;
}

const state: FakeState = { responses: [], calls: [] };

/** Queue the responses `messages.create` will return, in order (FIFO). */
export function setAnthropicResponses(responses: Array<{ content: ContentBlock[] }>): void {
  state.responses = [...responses];
}

/** @deprecated alias retained for the structured-call tests. */
export function setStructuredResponses(responses: Array<{ content: ContentBlock[] }>): void {
  state.responses = [...responses];
}

export function resetFakeAnthropic(): void {
  state.responses = [];
  state.calls = [];
}

export function getStructuredCalls(): Array<{ body: unknown; signal: AbortSignal | undefined }> {
  return state.calls;
}

export class Anthropic {
  constructor(_opts: { apiKey?: string }) {
    // ctor params are intentionally unused in the fake.
    void _opts;
  }
  messages = {
    async create(body: unknown, opts: { signal?: AbortSignal }): Promise<{ content: ContentBlock[] }> {
      state.calls.push({ body, signal: opts.signal });
      const next = state.responses.shift();
      if (!next) {
        throw new Error("fake-anthropic-sdk: no scripted response left");
      }
      return next;
    },
  };
}
