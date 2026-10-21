import type { FastifyInstance } from "fastify";
import { providerCategory } from "@echo/llm";
import { z } from "zod";
import type { LlmBackend } from "../llm/llm-backend.js";

const updateSchema = z.object({
  activeProviderId: z.string().optional(),
  profile: z
    .object({
      id: z.string(),
      model: z.string().min(1).optional(),
      baseUrl: z.string().url().optional(),
      enabled: z.boolean().optional(),
      label: z.string().optional(),
      generation: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().positive().max(128_000).optional(),
        })
        .optional(),
    })
    .optional(),
});

function withCategories<T extends { settings: { providers: Parameters<typeof providerCategory>[0][] } }>(
  data: T,
) {
  return {
    ...data,
    settings: {
      ...data.settings,
      providers: data.settings.providers.map((p) => ({
        ...p,
        category: providerCategory(p),
      })),
    },
  };
}

export async function registerLlmRoutes(app: FastifyInstance, llm: LlmBackend): Promise<void> {
  app.get("/api/v1/llm/status", async () => ({
    available: llm.isAvailable(),
    adapter: llm.adapter,
    moduleId: llm.isAvailable() ? llm.getModuleId() : null,
  }));

  app.get("/api/v1/llm/settings", async (_req, reply) => {
    if (!llm.isAvailable()) {
      return reply.status(503).send({ error: "LLM module is not connected" });
    }
    try {
      const data = await llm.getSettings();
      return withCategories(data);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to read LLM settings",
      });
    }
  });

  app.patch("/api/v1/llm/settings", async (req, reply) => {
    if (!llm.isAvailable()) {
      return reply.status(503).send({ error: "LLM module is not connected" });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    try {
      const data = await llm.updateSettings(parsed.data);
      return withCategories(data);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to update LLM settings",
      });
    }
  });
}
