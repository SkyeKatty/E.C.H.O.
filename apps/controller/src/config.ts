import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ProviderConfig } from "@echo/llm";

const modelCapabilitiesSchema = z
  .object({
    toolCalling: z.boolean().optional(),
    streaming: z.boolean().optional(),
    vision: z.boolean().optional(),
    maxContextTokens: z.number().int().positive().optional(),
  })
  .optional();

const providerConfigSchema: z.ZodType<ProviderConfig> = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    type: z.literal("openrouter"),
    label: z.string().optional(),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    siteUrl: z.string().optional(),
    siteName: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    capabilities: modelCapabilitiesSchema,
  }),
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    type: z.literal("openai_compatible"),
    label: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    capabilities: modelCapabilitiesSchema,
  }),
]);

const configSchema = z.object({
  controller: z.object({
    id: z.string().default("echo-controller"),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(8787),
    moduleWsPath: z.string().default("/ws/modules"),
    dashboardWsPath: z.string().default("/ws/dashboard"),
    moduleAuthToken: z.string().optional(),
    publicBaseUrl: z.string().optional(),
  }),
  persona: z
    .object({
      name: z.string().default("Echo"),
      reactiveOnly: z.boolean().default(true),
      identity: z.string().optional(),
      communicationStyle: z.string().optional(),
      behavioralGuidelines: z.string().optional(),
    })
    .default({}),
  cognition: z
    .object({
      /** `module` = separate LLM process (default). `embedded` = in-controller @echo/llm runtime. */
      llmAdapter: z.enum(["module", "embedded"]).default("module"),
      defaultProvider: z.string().default("openrouter"),
      maxToolIterations: z.number().int().positive().max(32).default(6),
      requestTimeoutMs: z.number().int().positive().default(120_000),
      moduleRequestTimeoutMs: z.number().int().positive().default(30_000),
    })
    .default({}),
  providers: z.array(providerConfigSchema).default([
    {
      id: "openrouter",
      type: "openrouter",
      model: "openai/gpt-4o-mini",
    },
    {
      id: "local-gpu",
      type: "openai_compatible",
      label: "Local GPU (Ollama)",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      capabilities: { toolCalling: false, streaming: true, vision: false },
    },
  ]),
  logging: z
    .object({
      level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
      pretty: z.boolean().default(true),
    })
    .default({}),
  modules: z
    .object({
      heartbeatIntervalMs: z.number().int().positive().default(15_000),
      heartbeatTimeoutMs: z.number().int().positive().default(45_000),
    })
    .default({}),
  memory: z
    .object({
      /** After each chat turn, LLM extracts durable facts and proposes memories (auto-promotion in module). */
      autoExtract: z.boolean().default(true),
      extractMinConfidence: z.number().min(0).max(1).default(0.65),
      extractMinUserMessageLength: z.number().int().min(0).default(12),
      extractTimeoutMs: z.number().int().positive().default(45_000),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const controller = (raw.controller as Record<string, unknown>) ?? {};
  if (process.env.ECHO_CONTROLLER_HOST) controller.host = process.env.ECHO_CONTROLLER_HOST;
  if (process.env.ECHO_CONTROLLER_PORT) controller.port = Number(process.env.ECHO_CONTROLLER_PORT);
  if (process.env.ECHO_MODULE_AUTH_TOKEN) controller.moduleAuthToken = process.env.ECHO_MODULE_AUTH_TOKEN;
  raw.controller = controller;

  const cognition = (raw.cognition as Record<string, unknown>) ?? {};
  if (process.env.ECHO_LLM_DEFAULT_PROVIDER) {
    cognition.defaultProvider = process.env.ECHO_LLM_DEFAULT_PROVIDER;
  }
  raw.cognition = cognition;

  return raw;
}

function resolveConfigPath(explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env.ECHO_CONFIG,
    resolve(process.cwd(), "config.yaml"),
    resolve(process.cwd(), "../../config.yaml"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function loadConfig(configPath?: string): AppConfig {
  const path = resolveConfigPath(configPath);

  let raw: Record<string, unknown> = {};
  if (path && existsSync(path)) {
    const text = readFileSync(path, "utf8");
    raw = parseYaml(text) as Record<string, unknown>;
  }

  raw = applyEnvOverrides(raw);
  return configSchema.parse(raw);
}

