import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "./types.js";
import { LLMProviderError } from "./errors.js";
import { parseSseJsonStream } from "./sse.js";

export type OpenAIChatClientOptions = {
  baseUrl: string;
  apiKey?: string;
  /** When set, called on each request so API keys from env stay current. */
  resolveApiKey?: () => string | undefined;
  defaultModel: string;
  providerId: string;
  label: string;
  extraHeaders?: Record<string, string>;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  capabilities: {
    toolCalling: boolean;
    streaming: boolean;
    vision: boolean;
    maxContextTokens?: number;
  };
};

type OpenAIChatResponse = {
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
};

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function buildBody(request: CompletionRequest, model: string, stream: boolean, defaults: OpenAIChatClientOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model ?? model,
    messages: request.messages,
    stream,
  };
  const temperature = request.temperature ?? defaults.defaultTemperature;
  if (temperature !== undefined) body.temperature = temperature;
  const maxTokens = request.maxTokens ?? defaults.defaultMaxTokens;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (defaults.capabilities.toolCalling && request.tools?.length) {
    body.tools = request.tools;
    body.tool_choice = request.toolChoice ?? "auto";
  }
  return body;
}

function resolveKey(options: OpenAIChatClientOptions): string | undefined {
  const key = options.resolveApiKey?.() ?? options.apiKey;
  return key?.trim() || undefined;
}

function headers(options: OpenAIChatClientOptions): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.extraHeaders,
  };
  const apiKey = resolveKey(options);
  if (apiKey) {
    h.Authorization = `Bearer ${apiKey}`;
  }
  return h;
}

function authErrorMessage(options: OpenAIChatClientOptions, upstream: string): string {
  if (options.providerId === "openrouter" || options.baseUrl.includes("openrouter.ai")) {
    return (
      "OpenRouter rejected the request (missing or invalid API key). " +
      "Set OPENROUTER_API_KEY in the environment for the LLM module process (pnpm dev:llm), " +
      "or add it to a .env file in the project root. " +
      `Upstream: ${upstream}`
    );
  }
  return upstream;
}

function mapUsage(usage?: OpenAIChatResponse["usage"]): CompletionUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function mapAssistantMessage(msg: NonNullable<OpenAIChatResponse["choices"]>[0]["message"]): ChatMessage {
  return {
    role: "assistant",
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls,
  };
}

export class OpenAIChatClient {
  constructor(private readonly options: OpenAIChatClientOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  get label(): string {
    return this.options.label;
  }

  get model(): string {
    return this.options.defaultModel;
  }

  getCapabilities() {
    return { ...this.options.capabilities };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (!resolveKey(this.options) && this.options.baseUrl.includes("openrouter")) {
      throw new LLMProviderError(
        authErrorMessage(this.options, "Missing Authentication Header"),
        "MISSING_API_KEY",
        401,
      );
    }
    const res = await fetch(chatCompletionsUrl(this.options.baseUrl), {
      method: "POST",
      headers: headers(this.options),
      body: JSON.stringify(buildBody(request, this.model, false, this.options)),
      signal: request.signal,
    });

    const json = (await res.json()) as OpenAIChatResponse;
    if (!res.ok) {
      const upstream = json.error?.message ?? `HTTP ${res.status}`;
      const message =
        res.status === 401 || /authentication/i.test(upstream)
          ? authErrorMessage(this.options, upstream)
          : upstream;
      throw new LLMProviderError(
        message,
        json.error?.code ?? "HTTP_ERROR",
        res.status,
        res.status >= 500 || res.status === 429,
      );
    }

    const choice = json.choices?.[0];
    if (!choice?.message) {
      throw new LLMProviderError("Empty completion response", "EMPTY_RESPONSE");
    }

    return {
      message: mapAssistantMessage(choice.message),
      finishReason: choice.finish_reason ?? null,
      usage: mapUsage(json.usage),
      model: json.model ?? request.model ?? this.model,
      providerId: this.options.providerId,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent, void, undefined> {
    if (!this.options.capabilities.streaming) {
      const result = await this.complete(request);
      if (result.message.content) {
        yield { type: "text-delta", delta: result.message.content };
      }
      yield { type: "done", result };
      return;
    }

    const res = await fetch(chatCompletionsUrl(this.options.baseUrl), {
      method: "POST",
      headers: headers(this.options),
      body: JSON.stringify(buildBody(request, this.model, true, this.options)),
      signal: request.signal,
    });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as OpenAIChatResponse;
        message = errJson.error?.message ?? message;
      } catch {
        // ignore
      }
      if (res.status === 401 || /authentication/i.test(message)) {
        message = authErrorMessage(this.options, message);
      }
      yield { type: "error", code: "HTTP_ERROR", message };
      return;
    }

    if (!res.body) {
      yield { type: "error", code: "NO_BODY", message: "Streaming response has no body" };
      return;
    }

    let finishReason: string | null = null;
    let usage: CompletionUsage | undefined;
    let responseModel = request.model ?? this.model;
    const toolCalls = new Map<number, ToolCall>();
    let text = "";

    for await (const chunk of parseSseJsonStream(res.body)) {
      const data = chunk as OpenAIChatResponse;
      if (data.error?.message) {
        yield { type: "error", code: data.error.code ?? "STREAM_ERROR", message: data.error.message };
        return;
      }
      if (data.model) responseModel = data.model;
      if (data.usage) usage = mapUsage(data.usage);

      const choice = data.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: "text-delta", delta: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          let existing = toolCalls.get(index);
          if (!existing) {
            existing = {
              id: tc.id ?? `call_${index}`,
              type: "function",
              function: { name: tc.function?.name ?? "", arguments: "" },
            };
            toolCalls.set(index, existing);
          }
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name = tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }

    const message: ChatMessage = {
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.size > 0 ? [...toolCalls.values()] : undefined,
    };

    yield {
      type: "done",
      result: {
        message,
        finishReason,
        usage,
        model: responseModel,
        providerId: this.options.providerId,
      },
    };
  }
}

export function toolDefinitionsToOpenAI(tools: ToolDefinition[]): ToolDefinition[] {
  return tools;
}
