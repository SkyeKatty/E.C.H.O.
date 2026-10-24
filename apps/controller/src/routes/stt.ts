import type { FastifyInstance } from "fastify";
import {
  sttAudioAppendSchema,
  sttConfigApplySchema,
  sttSessionEndSchema,
  sttSessionStartSchema,
} from "@echo/voice-contract";
import type { SttModuleService } from "../stt/stt-module-service.js";

export function registerSttRoutes(
  app: FastifyInstance,
  opts: {
    stt: SttModuleService;
    moduleAuthToken?: string;
  },
): void {
  const authorizeModule = (authHeader: string | undefined): boolean => {
    if (!opts.moduleAuthToken) return true;
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    return token === opts.moduleAuthToken;
  };

  app.get("/api/v1/stt/status", async () => ({
    moduleAvailable: opts.stt.isAvailable(),
    moduleId: opts.stt.getModuleId(),
    moduleStatus: opts.stt.isAvailable() ? await opts.stt.getStatus().catch(() => null) : null,
  }));

  app.get("/api/v1/stt/settings", async () => ({
    moduleAvailable: opts.stt.isAvailable(),
    moduleId: opts.stt.getModuleId(),
    settings: opts.stt.isAvailable() ? await opts.stt.getStatus().catch(() => null) : null,
  }));

  app.put("/api/v1/stt/settings", async (req, reply) => {
    const parsed = sttConfigApplySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid settings", details: parsed.error.flatten() });
    }
    if (!opts.stt.isAvailable()) {
      return reply.status(503).send({ error: "STT module is not connected" });
    }
    try {
      await opts.stt.applyConfig(parsed.data);
      const settings = await opts.stt.getStatus().catch(() => null);
      return { ok: true, settings };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "Apply failed" });
    }
  });

  app.post("/api/v1/stt/session/start", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = sttSessionStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    if (!opts.stt.isAvailable()) {
      return reply.status(503).send({ error: "STT module is not connected" });
    }
    try {
      await opts.stt.sessionStart(parsed.data);
      return { accepted: true };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "STT session failed" });
    }
  });

  app.post("/api/v1/stt/audio", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = sttAudioAppendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    if (!opts.stt.isAvailable()) {
      return reply.status(503).send({ error: "STT module is not connected" });
    }
    try {
      await opts.stt.audioAppend(parsed.data);
      return { accepted: true };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "STT append failed" });
    }
  });

  app.post("/api/v1/stt/session/end", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = sttSessionEndSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    if (!opts.stt.isAvailable()) {
      return reply.status(503).send({ error: "STT module is not connected" });
    }
    try {
      void opts.stt.sessionEnd(parsed.data).catch(() => {});
      return { accepted: true };
    } catch (err) {
      return reply.status(502).send({ error: err instanceof Error ? err.message : "STT end failed" });
    }
  });
}
