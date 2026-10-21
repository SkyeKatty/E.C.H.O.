import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelCapabilities,
  StreamEvent,
} from "./types.js";

/** Deterministic provider for unit tests — no network. */
export class MockLLMProvider implements LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  responses: Array<Partial<CompletionResult> | ((req: CompletionRequest) => Partial<CompletionResult>)> = [];
  private callIndex = 0;

  constructor(id = "mock", model = "mock-model") {
    this.id = id;
    this.label = "Mock";
    this.model = model;
  }

  getCapabilities(): ModelCapabilities {
    return { toolCalling: true, streaming: true, vision: false };
  }

  queue(result: Partial<CompletionResult> | ((req: CompletionRequest) => Partial<CompletionResult>)): void {
    this.responses.push(result);
  }

  private next(req: CompletionRequest): CompletionResult {
    const template = this.responses[this.callIndex++] ?? {
      message: { role: "assistant" as const, content: "Mock reply" },
    };
    const partial = typeof template === "function" ? template(req) : template;
    return {
      message: partial.message ?? { role: "assistant", content: "Mock reply" },
      finishReason: partial.finishReason ?? "stop",
      usage: partial.usage,
      model: partial.model ?? this.model,
      providerId: partial.providerId ?? this.id,
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (request.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return this.next(request);
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent, void, undefined> {
    const result = await this.complete(request);
    const text = result.message.content ?? "";
    if (text) yield { type: "text-delta", delta: text };
    yield { type: "done", result };
  }
}
