import type { ProviderConfig } from "../types.js";
import { OpenAIChatClient } from "../openai-chat.js";

/**
 * Local GPU inference via an OpenAI-compatible HTTP API.
 * Works with Ollama (/v1), vLLM, llama.cpp server, LM Studio, LocalAI, etc.
 * The model runs on GPU in that server process — not inside ECHO.
 */
export function createOpenAICompatibleProvider(
  config: Extract<ProviderConfig, { type: "openai_compatible" }>,
): OpenAIChatClient {
  const baseUrl = config.baseUrl ?? process.env.ECHO_LOCAL_LLM_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      `OpenAI-compatible provider "${config.id}" requires baseUrl in config or ECHO_LOCAL_LLM_BASE_URL`,
    );
  }

  const model = config.model ?? process.env.ECHO_LOCAL_LLM_MODEL;
  if (!model) {
    throw new Error(
      `OpenAI-compatible provider "${config.id}" requires model in config or ECHO_LOCAL_LLM_MODEL`,
    );
  }

  const isOpenRouterHost = /openrouter\.ai/i.test(baseUrl);
  const resolveApiKey = () => {
    if (isOpenRouterHost) {
      return (config.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim() || undefined;
    }
    return (config.apiKey ?? process.env.ECHO_LOCAL_LLM_API_KEY ?? process.env.OPENAI_API_KEY)?.trim() ||
      undefined;
  };
  const apiKey = resolveApiKey();

  if (isOpenRouterHost && !apiKey) {
    throw new Error(
      `OpenAI-compatible URL points at OpenRouter but OPENROUTER_API_KEY is not set (LLM module process / .env)`,
    );
  }

  const caps = config.capabilities ?? {};

  return new OpenAIChatClient({
    baseUrl,
    apiKey,
    resolveApiKey,
    defaultModel: model,
    providerId: config.id,
    label: config.label ?? "Local LLM",
    defaultTemperature: config.temperature,
    defaultMaxTokens: config.maxTokens,
    capabilities: {
      toolCalling: caps.toolCalling ?? false,
      streaming: caps.streaming ?? true,
      vision: caps.vision ?? false,
      maxContextTokens: caps.maxContextTokens,
    },
  });
}
