import type { ChatMessage, LLMProvider, StreamEvent, ToolDefinition } from "@echo/llm";
import { describeOperationalError } from "../util/operational-error.js";

export type ModuleInvoker = (
  capabilityId: string,
  params: unknown,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<unknown>;

export type CognitiveLoopOptions = {
  provider: LLMProvider;
  tools: ToolDefinition[];
  invokeModule: ModuleInvoker;
  resolveCapabilityId: (toolName: string) => string;
  maxIterations: number;
  requestTimeoutMs: number;
  onEvent?: (event: CognitiveTraceEvent) => void;
};

export type CognitiveTraceEvent =
  | { type: "model.start"; iteration: number }
  | { type: "model.delta"; delta: string }
  | { type: "tool.start"; name: string; capabilityId: string }
  | { type: "tool.end"; name: string; capabilityId: string; ok: boolean }
  | { type: "tool.error"; name: string; capabilityId: string; detail: string }
  | { type: "loop.error"; detail: string }
  | { type: "model.end"; usage?: { totalTokens?: number } };

export type CognitiveLoopResult = {
  assistantMessage: ChatMessage;
  newMessages: ChatMessage[];
  usage?: { totalTokens?: number };
  providerId: string;
  model: string;
};

export async function runCognitiveLoop(input: {
  messages: ChatMessage[];
  options: CognitiveLoopOptions;
  signal?: AbortSignal;
  stream: boolean;
  onStream?: (event: StreamEvent) => void;
}): Promise<CognitiveLoopResult> {
  const { options } = input;
  const working = [...input.messages];
  const newMessages: ChatMessage[] = [];
  let lastModel = options.provider.model;
  let lastProviderId = options.provider.id;
  let totalTokens: number | undefined;

  const tools = options.tools.length && options.provider.getCapabilities().toolCalling ? options.tools : [];

  for (let iteration = 0; iteration < options.maxIterations; iteration++) {
    options.onEvent?.({ type: "model.start", iteration });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException(
          `LLM iteration timed out after ${options.requestTimeoutMs}ms`,
          "TimeoutError",
        ),
      );
    }, options.requestTimeoutMs);
    const linked = input.signal;
    const onAbort = () => {
      const reason =
        linked?.reason ??
        new DOMException("Chat task cancelled (parent abort signal)", "AbortError");
      controller.abort(reason);
    };
    linked?.addEventListener("abort", onAbort);

    let result;
    try {
      if (input.stream) {
        let streamedText = "";
        for await (const ev of options.provider.stream({
          messages: working,
          tools: tools.length ? tools : undefined,
          signal: controller.signal,
        })) {
          input.onStream?.(ev);
          if (ev.type === "text-delta") {
            streamedText += ev.delta;
            options.onEvent?.({ type: "model.delta", delta: ev.delta });
          }
          if (ev.type === "error") {
            throw new Error(ev.message);
          }
          if (ev.type === "done") {
            result = ev.result;
          }
        }
        if (!result) {
          result = {
            message: { role: "assistant" as const, content: streamedText || null },
            finishReason: "stop",
            model: options.provider.model,
            providerId: options.provider.id,
          };
        }
      } else {
        result = await options.provider.complete({
          messages: working,
          tools: tools.length ? tools : undefined,
          signal: controller.signal,
        });
      }
    } catch (err) {
      const { message, logLine } = describeOperationalError(err, {
        operation: "llm.iteration",
        timeoutMs: options.requestTimeoutMs,
      });
      options.onEvent?.({ type: "loop.error", detail: logLine });
      throw new Error(message, { cause: err instanceof Error ? err : undefined });
    } finally {
      clearTimeout(timeout);
      linked?.removeEventListener("abort", onAbort);
    }

    lastModel = result.model;
    lastProviderId = result.providerId;
    if (result.usage?.totalTokens) {
      totalTokens = (totalTokens ?? 0) + result.usage.totalTokens;
    }

    options.onEvent?.({ type: "model.end", usage: { totalTokens: result.usage?.totalTokens } });

    const assistantMsg = result.message;
    working.push(assistantMsg);
    newMessages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls?.length) {
      return {
        assistantMessage: assistantMsg,
        newMessages,
        usage: totalTokens ? { totalTokens } : undefined,
        providerId: lastProviderId,
        model: lastModel,
      };
    }

    for (const call of toolCalls) {
      const capabilityId = options.resolveCapabilityId(call.function.name);
      options.onEvent?.({ type: "tool.start", name: call.function.name, capabilityId });
      let toolContent: string;
      let ok = true;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const toolResult = await options.invokeModule(capabilityId, args, { signal: input.signal });
        toolContent = JSON.stringify(toolResult);
      } catch (err) {
        ok = false;
        const { message, logLine } = describeOperationalError(err, {
          operation: "module.invoke",
          capabilityId,
        });
        options.onEvent?.({ type: "tool.error", name: call.function.name, capabilityId, detail: logLine });
        toolContent = JSON.stringify({ error: message });
      }
      options.onEvent?.({ type: "tool.end", name: call.function.name, capabilityId, ok });

      const toolMessage: ChatMessage = {
        role: "tool",
        content: toolContent,
        tool_call_id: call.id,
      };
      working.push(toolMessage);
      newMessages.push(toolMessage);
    }
  }

  throw new Error(`Cognitive loop exceeded max iterations (${options.maxIterations})`);
}
