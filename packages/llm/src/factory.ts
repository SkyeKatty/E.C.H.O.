import type { LLMProvider, ProviderConfig } from "./types.js";
import { OpenAIChatClient } from "./openai-chat.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import { createOpenAICompatibleProvider } from "./providers/openai-compatible.js";

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case "openrouter":
      return createOpenRouterProvider(config);
    case "openai_compatible":
      return createOpenAICompatibleProvider(config);
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown provider type: ${(_exhaustive as ProviderConfig).type}`);
    }
  }
}

export function isOpenAIChatClient(provider: LLMProvider): provider is OpenAIChatClient {
  return provider instanceof OpenAIChatClient;
}
