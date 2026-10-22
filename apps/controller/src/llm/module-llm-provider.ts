import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelCapabilities,
  StreamEvent,
} from "@echo/llm";
import type { ModuleGateway } from "../ws/module-gateway.js";
import { LLM_COMPLETE } from "./constants.js";

type CompleteResponse = CompletionResult;

export class ModuleLlmProvider implements LLMProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly model: string,
    private readonly capabilities: ModelCapabilities,
    private readonly gateway: ModuleGateway,
    private readonly requestTimeoutMs: number,
  ) {}

  getCapabilities(): ModelCapabilities {
    return { ...this.capabilities };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const params = {
      providerId: this.id,
      model: request.model ?? this.model,
      messages: request.messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      providerExtras: request.providerExtras,
      stream: false as const,
    };
    const result = await this.gateway.invokeCapability(LLM_COMPLETE, params, {
      timeoutMs: this.requestTimeoutMs,
    });
    return result as CompleteResponse;
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent, void, undefined> {
    const pending: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    const push = (ev: StreamEvent) => {
      pending.push(ev);
      notify?.();
    };

    const completion = this.gateway
      .invokeCapability(
        LLM_COMPLETE,
        {
          providerId: this.id,
          model: request.model ?? this.model,
          messages: request.messages,
          tools: request.tools,
          toolChoice: request.toolChoice,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          providerExtras: request.providerExtras,
          stream: true,
        },
        {
          timeoutMs: this.requestTimeoutMs,
          onChunk: (chunk) => {
            const ev = chunk as StreamEvent;
            if (ev.type === "text-delta") push(ev);
          },
        },
      )
      .then((result) => {
        push({ type: "done", result: result as CompleteResponse });
      })
      .catch((err: Error) => {
        push({
          type: "error",
          code: err.name === "AbortError" ? "ABORTED" : "MODULE_ERROR",
          message: err.message,
        });
      });

    let finished = false;
    void completion.finally(() => {
      finished = true;
      notify?.();
    });

    while (!finished || pending.length) {
      while (pending.length) {
        const ev = pending.shift()!;
        yield ev;
        if (ev.type === "done" || ev.type === "error") return;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      notify = null;
    }
  }
}
