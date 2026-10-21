import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MemoryModuleService } from "../memory/memory-module-service.js";
import type { MemoryTransferService } from "../memory/memory-transfer-service.js";
import type { CharacterCardStore } from "../characters/store.js";

const personaQuerySchema = z.object({
  personaId: z.string().uuid().optional(),
});

export async function registerMemoryRoutes(
  app: FastifyInstance,
  memory: MemoryModuleService,
  transfer: MemoryTransferService,
  characters: CharacterCardStore,
): Promise<void> {
  function resolvePersonaId(explicit?: string): string {
    if (explicit) return explicit;
    const active = characters.getActive();
    if (!active) throw new Error("No active character");
    return active.id;
  }

  app.get("/api/v1/memory/status", async () => ({
    available: memory.isAvailable(),
    moduleId: memory.getModuleId(),
    modules: transfer.listMemoryModules(),
  }));

  app.get("/api/v1/memory/modules", async () => ({
    modules: transfer.listMemoryModules(),
  }));

  app.post("/api/v1/memory/transfer", async (req, reply) => {
    const body = req.body as {
      sourceModuleId?: string;
      targetModuleId?: string;
      personaIds?: string[];
      includeConversations?: boolean;
      mode?: "merge" | "skip_existing";
      batchSize?: number;
      dryRun?: boolean;
    };
    if (!body.sourceModuleId || !body.targetModuleId) {
      return reply.status(400).send({ error: "sourceModuleId and targetModuleId are required" });
    }
    try {
      const personaIds = body.personaIds?.length
        ? body.personaIds
        : [resolvePersonaId(undefined)];
      return await transfer.transfer({
        sourceModuleId: body.sourceModuleId,
        targetModuleId: body.targetModuleId,
        personaIds,
        includeConversations: body.includeConversations ?? false,
        mode: body.mode ?? "merge",
        batchSize: body.batchSize,
        dryRun: body.dryRun,
      });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Transfer failed" });
    }
  });

  app.get("/api/v1/memory/health", async (_req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    try {
      return await memory.getHealth();
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "Health check failed" });
    }
  });

  app.get("/api/v1/memory/search", async (req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    const q = req.query as Record<string, string | undefined>;
    try {
      const personaId = resolvePersonaId(q.personaId);
      return await memory.search({
        personaId,
        query: q.q,
        kind: q.kind,
        scope: q.scope,
        subjectKey: q.subjectKey,
        lifecycleState: q.lifecycleState,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Search failed" });
    }
  });

  app.get("/api/v1/memory/jobs", async (_req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    try {
      return await memory.listJobs();
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "Job list failed" });
    }
  });

  app.get("/api/v1/memory/:memoryId", async (req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    const { memoryId } = req.params as { memoryId: string };
    const parsed = personaQuerySchema.safeParse(req.query);
    try {
      const personaId = resolvePersonaId(parsed.success ? parsed.data.personaId : undefined);
      return await memory.get({ personaId, memoryId });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Get failed" });
    }
  });

  app.post("/api/v1/memory/propose", async (req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    try {
      const body = req.body as Record<string, unknown>;
      const personaId = resolvePersonaId(body.personaId as string | undefined);
      return await memory.propose({ ...body, personaId });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Propose failed" });
    }
  });

  app.patch("/api/v1/memory/:memoryId", async (req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    const { memoryId } = req.params as { memoryId: string };
    try {
      const body = req.body as Record<string, unknown>;
      const personaId = resolvePersonaId(body.personaId as string | undefined);
      return await memory.update({ ...body, personaId, memoryId });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Update failed" });
    }
  });

  app.delete("/api/v1/memory/:memoryId", async (req, reply) => {
    if (!memory.isAvailable()) {
      return reply.status(503).send({ error: "Memory module is not connected" });
    }
    const { memoryId } = req.params as { memoryId: string };
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const personaId = resolvePersonaId(body.personaId as string | undefined);
      return await memory.delete({ ...body, personaId, memoryId });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Delete failed" });
    }
  });

}
