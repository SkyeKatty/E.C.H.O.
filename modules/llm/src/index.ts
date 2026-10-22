import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ModuleClient } from "@echo/module-sdk";
import { loadProjectEnv, llmRuntimeSettingsSchema, openRouterKeyStatus } from "@echo/llm";
import { LlmModuleRuntime } from "./runtime.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const { root, loadedFiles } = loadProjectEnv(resolve(moduleDir, ".."));
const keyStatus = openRouterKeyStatus();
console.log("[llm] Project root:", root);
console.log("[llm] Env files loaded:", loadedFiles.length ? loadedFiles.join(", ") : "(none — use .env at repo root)");
console.log(
  "[llm] OPENROUTER_API_KEY:",
  keyStatus.configured ? `configured (${keyStatus.length} chars)` : "NOT SET — OpenRouter will fail",
);

const completionRequestSchema = z.object({
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.string().nullable().optional(),
      name: z.string().optional(),
      tool_call_id: z.string().optional(),
      tool_calls: z.array(z.record(z.unknown())).optional(),
    }),
  ),
  tools: z.array(z.record(z.unknown())).optional(),
  toolChoice: z.unknown().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  providerExtras: z.record(z.unknown()).optional(),
  stream: z.boolean().optional(),
});

const controllerUrl =
  process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const moduleId = process.env.ECHO_LLM_MODULE_ID ?? "llm-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const runtime = new LlmModuleRuntime();

const client = new ModuleClient({
  controllerUrl,
  authToken,
  registration: {
    moduleId,
    name: "LLM Provider Module",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [
      {
        id: "llm.settings.get",
        name: "Get LLM settings",
        description: "Returns active provider, models, and generation parameters",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: false,
        supportsCancellation: false,
      },
      {
        id: "llm.settings.update",
        name: "Update LLM settings",
        description: "Updates provider selection, model, and generation parameters",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: false,
        supportsCancellation: false,
      },
      {
        id: "llm.complete",
        name: "LLM completion",
        description: "Runs chat completion on the configured provider",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: true,
        supportsCancellation: true,
      },
    ],
    metadata: { role: "llm" },
  },
  logger: {
    info: (o, m) => console.log(`[llm] ${m ?? "info"}`, o),
    warn: (o, m) => console.warn(`[llm] ${m ?? "warn"}`, o),
    error: (o, m) => console.error(`[llm] ${m ?? "error"}`, o),
    debug: () => {},
  },
  onRegistered: () => console.log("[llm] Registered with controller"),
});

client.registerHandler("llm.settings.get", () => ({
  settings: runtime.getSettings(),
  loadErrors: runtime.getLoadErrors(),
}));

client.registerHandler("llm.settings.update", (_env, params) => {
  const body = z
    .object({
      activeProviderId: z.string().optional(),
      providers: z.array(z.record(z.unknown())).optional(),
      profile: z
        .object({
          id: z.string(),
          model: z.string().optional(),
          baseUrl: z.string().url().optional(),
          generation: z
            .object({
              temperature: z.number().min(0).max(2).optional(),
              maxTokens: z.number().int().positive().optional(),
            })
            .optional(),
          enabled: z.boolean().optional(),
          label: z.string().optional(),
        })
        .optional(),
      tasks: z
        .object({
          chat: z.object({ providerId: z.string().optional(), model: z.string().optional() }).optional(),
          discord_gate: z.object({ providerId: z.string().optional(), model: z.string().optional() }).optional(),
          episode_summary: z
            .object({ providerId: z.string().optional(), model: z.string().optional() })
            .optional(),
          memory_extract: z
            .object({ providerId: z.string().optional(), model: z.string().optional() })
            .optional(),
        })
        .optional(),
    })
    .parse(params ?? {});

  let next = runtime.getSettings();

  if (body.providers) {
    next = runtime.updateSettings({ providers: llmRuntimeSettingsSchema.shape.providers.parse(body.providers) });
  }

  if (body.activeProviderId) {
    next = runtime.updateSettings({ activeProviderId: body.activeProviderId });
  }

  if (body.tasks) {
    next = runtime.updateSettings({
      tasks: { ...next.tasks, ...body.tasks },
    });
  }

  if (body.profile) {
    const providers = next.providers.map((p) =>
      p.id === body.profile!.id
        ? {
            ...p,
            ...(body.profile!.model !== undefined ? { model: body.profile!.model } : {}),
            ...(body.profile!.baseUrl !== undefined ? { baseUrl: body.profile!.baseUrl } : {}),
            ...(body.profile!.enabled !== undefined ? { enabled: body.profile!.enabled } : {}),
            ...(body.profile!.label !== undefined ? { label: body.profile!.label } : {}),
            ...(body.profile!.generation
              ? { generation: { ...p.generation, ...body.profile!.generation } }
              : {}),
          }
        : p,
    );
    next = runtime.updateSettings({ providers });
  }

  return { settings: next, loadErrors: runtime.getLoadErrors() };
});

client.registerHandler("llm.complete", async (_env, params, ctx) => {
  const parsed = completionRequestSchema.parse(params ?? {});
  const request = {
    providerId: parsed.providerId,
    model: parsed.model,
    messages: parsed.messages,
    tools: parsed.tools,
    toolChoice: parsed.toolChoice,
    temperature: parsed.temperature,
    maxTokens: parsed.maxTokens,
    providerExtras: parsed.providerExtras,
    signal: ctx?.signal,
  } as import("@echo/llm").CompletionRequest;

  if (parsed.stream) {
    let text = "";
    let result: import("@echo/llm").CompletionResult | undefined;
    for await (const ev of runtime.stream(request)) {
      if (ev.type === "text-delta") {
        text += ev.delta;
        ctx?.sendChunk(ev);
      }
      if (ev.type === "done") result = ev.result;
      if (ev.type === "error") throw new Error(ev.message);
    }
    return (
      result ?? {
        message: { role: "assistant", content: text },
        finishReason: "stop",
        model: "",
        providerId: "",
      }
    );
  }

  return runtime.complete(request);
});

console.log(`[llm] Connecting to controller at ${controllerUrl} (start controller first: pnpm dev)`);
await client.start();
console.log("[llm] Ready");

async function shutdown(): Promise<void> {
  client.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
