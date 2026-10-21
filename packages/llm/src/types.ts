export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type CompletionRequest = {
  messages: ChatMessage[];
  model?: string;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type CompletionUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type CompletionResult = {
  message: ChatMessage;
  finishReason: string | null;
  usage?: CompletionUsage;
  model: string;
  providerId: string;
};

export type ModelCapabilities = {
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  maxContextTokens?: number;
};

export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "done"; result: CompletionResult }
  | { type: "error"; code: string; message: string };

export type LLMProviderInfo = {
  id: string;
  label: string;
  model: string;
  capabilities: ModelCapabilities;
};

export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  getCapabilities(): ModelCapabilities;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: CompletionRequest): AsyncGenerator<StreamEvent, void, undefined>;
}

export type ProviderConfig =
  | {
      id: string;
      enabled?: boolean;
      type: "openrouter";
      label?: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      siteUrl?: string;
      siteName?: string;
      temperature?: number;
      maxTokens?: number;
      capabilities?: Partial<ModelCapabilities>;
    }
  | {
      id: string;
      enabled?: boolean;
      type: "openai_compatible";
      label?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      capabilities?: Partial<ModelCapabilities>;
    };
