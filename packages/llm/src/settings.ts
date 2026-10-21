import { z } from "zod";
import type { ProviderConfig } from "./types.js";

export const providerKindSchema = z.enum(["openrouter", "openai_compatible"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** UI-facing category for openai_compatible backends. */
export const providerCategorySchema = z.enum(["local", "remote_api", "openrouter"]);
export type ProviderCategory = z.infer<typeof providerCategorySchema>;

export const generationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().max(128_000).default(2048),
});

export type GenerationParams = z.infer<typeof generationParamsSchema>;

export const providerProfileSchema = z.object({
  id: z.string().min(1),
  kind: providerKindSchema,
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  generation: generationParamsSchema.default({ temperature: 0.7, maxTokens: 2048 }),
  capabilities: z
    .object({
      toolCalling: z.boolean().optional(),
      streaming: z.boolean().optional(),
      vision: z.boolean().optional(),
    })
    .optional(),
});

export type ProviderProfile = z.infer<typeof providerProfileSchema>;

export const llmRuntimeSettingsSchema = z.object({
  activeProviderId: z.string().min(1),
  providers: z.array(providerProfileSchema).min(1),
});

export type LlmRuntimeSettings = z.infer<typeof llmRuntimeSettingsSchema>;

export function providerCategory(profile: ProviderProfile): ProviderCategory {
  if (profile.kind === "openrouter") return "openrouter";
  const url = profile.baseUrl ?? "";
  if (/localhost|127\.0\.0\.1|^http:\/\/\[::1\]/i.test(url)) return "local";
  return "remote_api";
}

export function profileToProviderConfig(profile: ProviderProfile): ProviderConfig {
  const generation = profile.generation ?? { temperature: 0.7, maxTokens: 2048 };
  const caps = profile.capabilities ?? {};
  if (profile.kind === "openrouter") {
    return {
      id: profile.id,
      enabled: profile.enabled,
      type: "openrouter",
      label: profile.label,
      model: profile.model,
      temperature: generation.temperature,
      maxTokens: generation.maxTokens,
      capabilities: caps,
    };
  }
  return {
    id: profile.id,
    enabled: profile.enabled,
    type: "openai_compatible",
    label: profile.label,
    model: profile.model,
    baseUrl: profile.baseUrl,
    temperature: generation.temperature,
    maxTokens: generation.maxTokens,
    capabilities: {
      toolCalling: caps.toolCalling ?? false,
      streaming: caps.streaming ?? true,
      vision: caps.vision ?? false,
    },
  };
}

export function defaultRuntimeSettings(): LlmRuntimeSettings {
  return llmRuntimeSettingsSchema.parse({
    activeProviderId: "openrouter",
    providers: [
      {
        id: "openrouter",
        kind: "openrouter",
        label: "OpenRouter",
        model: "openai/gpt-4o-mini",
        generation: { temperature: 0.7, maxTokens: 2048 },
        capabilities: { toolCalling: true, streaming: true, vision: true },
      },
      {
        id: "local-gpu",
        kind: "openai_compatible",
        label: "Local GPU (Ollama)",
        model: "llama3.2",
        baseUrl: "http://127.0.0.1:11434/v1",
        generation: { temperature: 0.7, maxTokens: 2048 },
        capabilities: { toolCalling: false, streaming: true, vision: false },
      },
      {
        id: "remote-api",
        kind: "openai_compatible",
        label: "Remote OpenAI-compatible API",
        model: "your-model-id",
        baseUrl: "http://192.168.1.10:8000/v1",
        generation: { temperature: 0.7, maxTokens: 2048 },
        capabilities: { toolCalling: false, streaming: true, vision: false },
      },
    ],
  });
}

export function settingsToProviderConfigs(settings: LlmRuntimeSettings): ProviderConfig[] {
  return settings.providers.map((p) => profileToProviderConfig(p));
}
