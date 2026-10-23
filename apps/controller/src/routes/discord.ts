import type { FastifyInstance } from "fastify";
import {
  discordConnectionFingerprint,
  discordChannelActivitySchema,
  discordInboundBatchSchema,
  discordRuntimeConfigSchema,
  discordVoiceTranscriptSchema,
} from "@echo/discord-contract";
import type { DiscordModuleService } from "../discord/discord-module-service.js";
import type { DiscordSettingsStore } from "../discord/settings-store.js";
import type { DiscordOrchestrator } from "../discord/discord-orchestrator.js";

export function registerDiscordRoutes(
  app: FastifyInstance,
  opts: {
    store: DiscordSettingsStore;
    discord: DiscordModuleService;
    orchestrator: DiscordOrchestrator;
    moduleAuthToken?: string;
    onConfigPushed?: (fingerprint: string) => void;
  },
): void {
  const authorizeModule = (authHeader: string | undefined): boolean => {
    if (!opts.moduleAuthToken) return true;
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    return token === opts.moduleAuthToken;
  };

  app.get("/api/v1/discord/settings", async () => {
    const settings = opts.store.load();
    let moduleStatus: unknown = null;
    if (opts.discord.isAvailable()) {
      try {
        moduleStatus = await opts.discord.getStatus();
      } catch {
        moduleStatus = { error: "status_unavailable" };
      }
    }
    return {
      settings: opts.store.redact(settings),
      moduleAvailable: opts.discord.isAvailable(),
      moduleId: opts.discord.getModuleId(),
      moduleStatus,
    };
  });

  app.put("/api/v1/discord/settings", async (req, reply) => {
    const parsed = discordRuntimeConfigSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid settings", details: parsed.error.flatten() });
    }
    const saved = opts.store.save(parsed.data);
    if (saved.enabled && !saved.botToken) {
      return reply.status(400).send({ error: "Bot token is required when Discord is enabled" });
    }
    if (opts.discord.isAvailable() && saved.enabled && saved.botToken) {
      try {
        await opts.discord.applyConfig(saved);
        opts.onConfigPushed?.(discordConnectionFingerprint(saved));
      } catch (err) {
        return reply.status(502).send({
          error: err instanceof Error ? err.message : "Failed to apply config to Discord module",
          settings: opts.store.redact(saved),
        });
      }
    } else if (saved.enabled && saved.botToken && !opts.discord.isAvailable()) {
      return reply.status(503).send({
        error: "Discord module is not connected. Start pnpm dev:discord, then save again.",
        settings: opts.store.redact(saved),
      });
    }
    return { settings: opts.store.redact(saved) };
  });

  app.post("/api/v1/discord/activity", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = discordChannelActivitySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    opts.orchestrator.enqueueActivity(parsed.data);
    return { accepted: true };
  });

  app.post("/api/v1/discord/inbound", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = discordInboundBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    for (const msg of parsed.data.messages) {
      opts.orchestrator.enqueueInbound(msg);
    }
    return { accepted: parsed.data.messages.length };
  });

  app.post("/api/v1/discord/voice/transcript", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = discordVoiceTranscriptSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    void opts.orchestrator.handleVoiceTranscript(parsed.data).catch(() => {});
    return { accepted: true };
  });

  app.post("/api/v1/discord/voice/interrupt", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const body = req.body as {
      guildId?: string;
      channelId?: string;
      userId?: string;
      displayName?: string;
    };
    if (!body.guildId || !body.channelId || !body.userId || !body.displayName) {
      return reply.status(400).send({ error: "Missing fields" });
    }
    void opts.orchestrator
      .handleVoiceInterrupt({
        guildId: body.guildId,
        channelId: body.channelId,
        userId: body.userId,
        displayName: body.displayName,
      })
      .catch(() => {});
    return { accepted: true };
  });
}
