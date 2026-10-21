import type { ProviderConfig } from "../types.js";
import { OpenAIChatClient } from "../openai-chat.js";

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider(config: Extract<ProviderConfig, { type: "openrouter" }>): OpenAIChatClient {
  const resolveApiKey = () => (config.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim() || undefined;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      `OpenRouter provider "${config.id}" requires apiKey in config or OPENROUTER_API_KEY environment variable (LLM module process)`,
    );
  }

  const extraHeaders: Record<string, string> = {};
  if (config.siteUrl ?? process.env.OPENROUTER_SITE_URL) {
    extraHeaders["HTTP-Referer"] = config.siteUrl ?? process.env.OPENROUTER_SITE_URL!;
  }
  if (config.siteName ?? process.env.OPENROUTER_SITE_NAME) {
    extraHeaders["X-Title"] = config.siteName ?? process.env.OPENROUTER_SITE_NAME!;
  }

  const caps = config.capabilities ?? {};

  return new OpenAIChatClient({
    baseUrl: config.baseUrl ?? DEFAULT_BASE,
    apiKey,
    resolveApiKey,
    defaultModel: config.model,
    providerId: config.id,
    label: config.label ?? "OpenRouter",
    extraHeaders,
    defaultTemperature: config.temperature,
    defaultMaxTokens: config.maxTokens,
    capabilities: {
      toolCalling: caps.toolCalling ?? true,
      streaming: caps.streaming ?? true,
      vision: caps.vision ?? true,
      maxContextTokens: caps.maxContextTokens,
    },
  });
}
