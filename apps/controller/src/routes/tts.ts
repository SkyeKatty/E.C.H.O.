import type { FastifyInstance } from "fastify";
import { ttsConfigApplySchema, ttsPlaybackChunkSchema } from "@echo/voice-contract";
import type { TtsModuleService } from "../tts/tts-module-service.js";
import type { TtsPlaybackRouter } from "../tts/tts-playback-router.js";

export function registerTtsRoutes(
  app: FastifyInstance,
  opts: {
    tts: TtsModuleService;
    playback: TtsPlaybackRouter;
    moduleAuthToken?: string;
  },
): void {
  const authorizeModule = (authHeader: string | undefined): boolean => {
    if (!opts.moduleAuthToken) return true;
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    return token === opts.moduleAuthToken;
  };

  app.get("/api/v1/tts/status", async () => ({
    moduleAvailable: opts.tts.isAvailable(),
    moduleId: opts.tts.getModuleId(),
    moduleStatus: opts.tts.isAvailable() ? await opts.tts.getStatus().catch(() => null) : null,
  }));

  app.get("/api/v1/tts/settings", async () => ({
    moduleAvailable: opts.tts.isAvailable(),
    moduleId: opts.tts.getModuleId(),
    settings: opts.tts.isAvailable() ? await opts.tts.getStatus().catch(() => null) : null,
  }));

  app.put("/api/v1/tts/settings", async (req, reply) => {
    const parsed = ttsConfigApplySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid settings", details: parsed.error.flatten() });
    }
    if (!opts.tts.isAvailable()) {
      return reply.status(503).send({ error: "TTS module is not connected" });
    }
    try {
      await opts.tts.applyConfig(parsed.data);
      const settings = await opts.tts.getStatus().catch(() => null);
      return { ok: true, settings };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "Apply failed" });
    }
  });

  app.post("/api/v1/tts/playback", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = ttsPlaybackChunkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    try {
      await opts.playback.handlePlayback(parsed.data);
      return { accepted: true, played: true };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Playback failed",
      });
    }
  });
}
