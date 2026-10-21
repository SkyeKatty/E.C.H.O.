import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CharacterCardStore } from "../characters/store.js";
import { characterCardInputSchema, characterCardUpdateSchema } from "../characters/schema.js";

export async function registerCharacterRoutes(
  app: FastifyInstance,
  store: CharacterCardStore,
  onChanged: () => void,
): Promise<void> {
  app.get("/api/v1/characters", async () => ({
    activeCharacterId: store.getActiveId(),
    characters: store.list(),
  }));

  app.get("/api/v1/characters/active", async (_req, reply) => {
    const card = store.getActive();
    if (!card) return reply.status(404).send({ error: "No active character card" });
    return { character: card };
  });

  app.put("/api/v1/characters/active", async (req, reply) => {
    const body = z.object({ characterId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: "Invalid body" });
    try {
      const card = store.setActive(body.data.characterId);
      onChanged();
      return { activeCharacterId: body.data.characterId, character: card };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : "Failed to set active" });
    }
  });

  app.get("/api/v1/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = store.get(id);
    if (!card) return reply.status(404).send({ error: "Not found" });
    return { character: card };
  });

  app.post("/api/v1/characters", async (req, reply) => {
    const parsed = characterCardInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid character card", details: parsed.error.flatten() });
    }
    const card = store.create(parsed.data);
    onChanged();
    return reply.status(201).send({ character: card });
  });

  app.patch("/api/v1/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = characterCardUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid update", details: parsed.error.flatten() });
    }
    try {
      const card = store.update(id, parsed.data);
      onChanged();
      return { character: card };
    } catch (err) {
      return reply.status(404).send({ error: err instanceof Error ? err.message : "Update failed" });
    }
  });

  app.delete("/api/v1/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      store.delete(id);
      onChanged();
      return { deleted: true };
    } catch (err) {
      return reply.status(404).send({ error: err instanceof Error ? err.message : "Delete failed" });
    }
  });
}
