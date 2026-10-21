import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { participantSchema } from "@echo/memory-contract";
import type { CognitiveEngine } from "../cognition/engine.js";

const chatBodySchema = z.object({
  message: z.string().min(1).max(32_000),
  sessionId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  speaker: participantSchema.optional(),
  stream: z.boolean().optional(),
  providerId: z.string().optional(),
  generation: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().max(128_000).optional(),
    })
    .optional(),
});

const historyQuerySchema = z.object({
  sessionId: z.string().uuid(),
});

export async function registerChatRoutes(app: FastifyInstance, engine: CognitiveEngine): Promise<void> {
  app.get("/api/v1/chat/history", async (req, reply) => {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    try {
      const history = await engine.getPersistedHistory(parsed.data.sessionId);
      return history;
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Failed to load history",
      });
    }
  });

  app.get("/api/v1/providers", async (_req, reply) => {
    if (!engine.isChatAvailable()) {
      return reply.status(503).send({ error: "LLM module is not connected", active: null, providers: [] });
    }
    const providers = await engine.listProviders();
    const active = await engine.getActiveProviderId();
    return { active, providers };
  });

  app.post("/api/v1/providers/:id/activate", async (req, reply) => {
    if (!engine.isChatAvailable()) {
      return reply.status(503).send({ error: "LLM module is not connected" });
    }
    const { id } = req.params as { id: string };
    try {
      const providers = await engine.setActiveProvider(id);
      return { active: id, providers };
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to activate provider",
      });
    }
  });

  app.post("/api/v1/chat/cancel/:taskId", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const ok = engine.cancelTask(taskId);
    if (!ok) return reply.status(404).send({ error: "Task not found or already finished" });
    return { cancelled: true };
  });

  app.post("/api/v1/chat", async (req, reply) => {
    if (!engine.isChatAvailable()) {
      return reply.status(503).send({ error: "LLM module is not connected" });
    }

    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { message, sessionId, stream, providerId, generation, speaker } = parsed.data;

    if (stream) {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const write = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const raw = reply.raw as typeof reply.raw & { flush?: () => void };
        raw.flush?.();
      };

      try {
        const { taskId: clientTaskId } = parsed.data;
        const result = await engine.chat({
          message,
          sessionId,
          taskId: clientTaskId,
          speaker,
          stream: true,
          providerId,
          generation,
          onStarted: (meta) => write("started", meta),
          onStream: (delta) => write("delta", { delta }),
          onTrace: (ev) => write("trace", ev),
        });
        write("done", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat failed";
        const aborted = err instanceof DOMException && err.name === "AbortError";
        write("error", { message: aborted ? "Request cancelled" : message, aborted });
      } finally {
        reply.raw.end();
      }
      return reply;
    }

    try {
      const result = await engine.chat({ message, sessionId, speaker, stream: false, providerId, generation });
      return result;
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Chat failed",
      });
    }
  });
}

