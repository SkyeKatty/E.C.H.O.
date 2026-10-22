import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { ModuleRegistry } from "./registry/module-registry.js";
import { createInitialPersonaState, EventLog, type SystemSnapshot } from "./persona/state.js";
import { personaDefinitionSchema } from "./persona/definition.js";
import { ModuleGateway } from "./ws/module-gateway.js";
import { DashboardHub } from "./ws/dashboard-hub.js";
import { CognitiveEngine } from "./cognition/engine.js";
import { registerChatRoutes } from "./routes/chat.js";
import { loadProjectEnv } from "@echo/llm";
import type { LlmBackend } from "./llm/llm-backend.js";
import { EmbeddedLlmService } from "./llm/embedded-llm-service.js";
import { LlmModuleService } from "./llm/llm-module-service.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { CharacterCardStore } from "./characters/store.js";
import { registerCharacterRoutes } from "./routes/characters.js";
import { MemoryModuleService } from "./memory/memory-module-service.js";
import { MemoryCurator } from "./memory/memory-curator.js";
import { EpisodeCompactor } from "./memory/episode-compactor.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { MemoryTransferService } from "./memory/memory-transfer-service.js";
import { DiscordSettingsStore } from "./discord/settings-store.js";
import { DiscordModuleService } from "./discord/discord-module-service.js";
import { DiscordOrchestrator } from "./discord/discord-orchestrator.js";
import { registerDiscordRoutes } from "./routes/discord.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildServer(config: AppConfig) {
  const memoryCfg = config.memory ?? loadConfig().memory;
  const startedAt = Date.now();
  const eventLog = new EventLog();
  const dashboardHub = new DashboardHub();

  const personaDef = personaDefinitionSchema.parse(config.persona);
  const characterStore = new CharacterCardStore();
  const seeded = characterStore.ensureSeeded(personaDef);

  const persona = createInitialPersonaState({
    name: seeded.name,
    activeCharacterId: seeded.id,
    reactiveOnly: personaDef.reactiveOnly,
  });

  function updatePersonaFromActiveCharacter(): void {
    const active = characterStore.getActive();
    persona.name = active?.name ?? personaDef.name;
    persona.activeCharacterId = active?.id ?? null;
  }

  updatePersonaFromActiveCharacter();

  let moduleGateway!: ModuleGateway;
  let llmBackend!: LlmBackend;
  let memoryService!: MemoryModuleService;
  let syncingPersonaFromLlm = false;
  const discordStore = new DiscordSettingsStore();
  let discordService!: DiscordModuleService;
  let syncDiscordConfig!: () => Promise<void>;

  function buildSnapshot(): SystemSnapshot {
    return {
      controllerId: config.controller.id,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      persona: { ...persona },
      modules: registry.snapshot(),
      llm: {
        moduleAvailable: llmBackend?.isAvailable() ?? false,
        adapter: llmBackend?.adapter ?? config.cognition.llmAdapter,
        moduleId: llmBackend?.isAvailable() ? llmBackend.getModuleId() : null,
      },
      memory: {
        moduleAvailable: memoryService?.isAvailable() ?? false,
        moduleId: memoryService?.isAvailable() ? memoryService.getModuleId() : null,
        primaryModuleId: memoryCfg.primaryModuleId ?? null,
        connectedModules: registry.listModulesWithCapability("memory.health.get").length,
      },
      discord: {
        moduleAvailable: discordService?.isAvailable() ?? false,
        moduleId: discordService?.isAvailable() ? discordService.getModuleId() : null,
        enabled: discordStore.load().enabled,
      },
      character: {
        activeCharacterId: persona.activeCharacterId,
        activeCharacterName: persona.name,
      },
      recentEvents: eventLog.list(),
    };
  }

  function publishSnapshot(): void {
    dashboardHub.broadcast(buildSnapshot());
  }

  function syncPersonaFromActiveCharacter(): void {
    updatePersonaFromActiveCharacter();
    publishSnapshot();
  }

  async function syncPersonaFromLlmModule(): Promise<void> {
    if (syncingPersonaFromLlm) return;
    syncingPersonaFromLlm = true;
    try {
      if (!llmBackend?.isAvailable()) {
        persona.activeProvider = null;
        persona.activeModel = null;
        publishSnapshot();
        return;
      }
      const { settings } = await llmBackend.getSettings();
      const profile = settings.providers.find((p) => p.id === settings.activeProviderId);
      persona.activeProvider = settings.activeProviderId;
      persona.activeModel = profile?.model ?? null;
      publishSnapshot();
    } catch {
      publishSnapshot();
    } finally {
      syncingPersonaFromLlm = false;
    }
  }

  const registry = new ModuleRegistry({
    heartbeatIntervalMs: config.modules.heartbeatIntervalMs,
    heartbeatTimeoutMs: config.modules.heartbeatTimeoutMs,
    onChange: () => {
      publishSnapshot();
    },
  });

  const app = Fastify({
    logger: {
      level: config.logging.level,
      transport: config.logging.pretty
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    },
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  moduleGateway = new ModuleGateway(
    registry,
    eventLog,
    config.controller.id,
    config.controller.moduleAuthToken,
    app.log,
    () => publishSnapshot(),
    () => {
      void syncPersonaFromLlmModule();
    },
    () => {
      void syncDiscordConfig?.();
    },
  );

  if (config.cognition.llmAdapter === "embedded") {
    loadProjectEnv(resolve(__dirname, "../../.."));
    llmBackend = new EmbeddedLlmService();
    app.log.info("LLM adapter: embedded (in-controller runtime)");
  } else {
    llmBackend = new LlmModuleService(registry, moduleGateway, config.cognition.requestTimeoutMs);
    app.log.info("LLM adapter: module (start pnpm dev:llm for chat)");
  }

  memoryService = new MemoryModuleService(
    registry,
    moduleGateway,
    config.cognition.moduleRequestTimeoutMs,
    memoryCfg.primaryModuleId,
  );
  const memoryTransfer = new MemoryTransferService(
    registry,
    moduleGateway,
    memoryCfg.transferRequestTimeoutMs ?? 120_000,
  );

  const memoryCurator = new MemoryCurator(llmBackend, memoryService, eventLog, {
    enabled: memoryCfg.autoExtract,
    minConfidence: memoryCfg.extractMinConfidence,
    minUserMessageLength: memoryCfg.extractMinUserMessageLength,
    requestTimeoutMs: memoryCfg.extractTimeoutMs,
  });

  const episodeCfg = memoryCfg.episodeCompaction ?? {
    enabled: true,
    hotWindowMessages: 24,
    minMessagesPerEpisode: 16,
    maxMessagesPerEpisode: 80,
    timeoutMs: 60_000,
  };
  const episodeCompactor = new EpisodeCompactor(llmBackend, memoryService, eventLog, {
    enabled: episodeCfg.enabled,
    hotWindowMessages: episodeCfg.hotWindowMessages,
    minMessagesPerEpisode: episodeCfg.minMessagesPerEpisode,
    maxMessagesPerEpisode: episodeCfg.maxMessagesPerEpisode,
    requestTimeoutMs: episodeCfg.timeoutMs,
  });

  const setPersonaState = (patch: Partial<typeof persona>) => {
    Object.assign(persona, patch);
    publishSnapshot();
  };

  discordService = new DiscordModuleService(
    registry,
    moduleGateway,
    config.cognition.moduleRequestTimeoutMs,
  );

  let discordPromptCache: { at: number; text: string } | null = null;

  const engine = new CognitiveEngine(
    llmBackend,
    registry,
    moduleGateway,
    characterStore,
    { behavioralGuidelines: personaDef.behavioralGuidelines },
    () => persona,
    setPersonaState,
    eventLog,
    {
      maxToolIterations: config.cognition.maxToolIterations,
      requestTimeoutMs: config.cognition.requestTimeoutMs,
      moduleRequestTimeoutMs: config.cognition.moduleRequestTimeoutMs,
      promptHistoryMessages: episodeCfg.hotWindowMessages,
      memoryRetrievalTokenBudget: memoryCfg.retrieval?.tokenBudget,
      memoryRetrievalMaxItems: memoryCfg.retrieval?.maxItems,
      sessionHydrationLimit: Math.max(episodeCfg.hotWindowMessages * 2, 80),
      discordModule: discordService,
      fetchDiscordPromptContext: async () => {
        const cfg = discordStore.load();
        if (!cfg.enabled || !discordService.isAvailable()) return undefined;
        const cached = discordPromptCache;
        if (cached && Date.now() - cached.at < 60_000) return cached.text;
        const { formatDiscordChannelDirectory } = await import("./discord/channel-directory.js");
        const list = await discordService.listChannels();
        const text = formatDiscordChannelDirectory(cfg, list);
        discordPromptCache = { at: Date.now(), text };
        return text;
      },
    },
    memoryService,
    memoryCurator,
    episodeCompactor,
  );
  const discordOrchestrator = new DiscordOrchestrator(
    discordStore,
    discordService,
    engine,
    characterStore,
    llmBackend,
    eventLog,
    Math.max(45_000, config.cognition.moduleRequestTimeoutMs),
  );
  let discordConfigPushInFlight: Promise<void> | null = null;
  let lastDiscordConfigPushFp: string | null = null;

  syncDiscordConfig = async () => {
    if (!discordService.isAvailable()) return;
    const saved = discordStore.load();
    if (!saved.enabled || !saved.botToken) return;

    const { discordConnectionFingerprint } = await import("@echo/discord-contract");
    const fp = discordConnectionFingerprint(saved);
    if (fp === lastDiscordConfigPushFp) return;
    if (discordConfigPushInFlight) return discordConfigPushInFlight;

    discordConfigPushInFlight = (async () => {
      try {
        await discordService.applyConfig(saved);
        lastDiscordConfigPushFp = fp;
      } catch (err) {
        eventLog.append({
          type: "discord.warn",
          summary: `Discord config sync failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      } finally {
        discordConfigPushInFlight = null;
      }
    })();

    return discordConfigPushInFlight;
  };

  await registerLlmRoutes(app, llmBackend);

  if (llmBackend.adapter === "embedded") {
    void syncPersonaFromLlmModule();
  }
  await registerChatRoutes(app, engine);
  await registerMemoryRoutes(app, memoryService, memoryTransfer, characterStore);
  registerDiscordRoutes(app, {
    store: discordStore,
    discord: discordService,
    orchestrator: discordOrchestrator,
    moduleAuthToken: config.controller.moduleAuthToken,
    onConfigPushed: (fp) => {
      lastDiscordConfigPushFp = fp;
    },
  });

  await registerCharacterRoutes(app, characterStore, () => {
    syncPersonaFromActiveCharacter();
    eventLog.append({
      type: "character.updated",
      summary: `Active character: ${characterStore.getActive()?.name ?? "none"}`,
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    controllerId: config.controller.id,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    llmModule: llmBackend.isAvailable(),
    llmAdapter: llmBackend.adapter,
  }));

  app.get("/api/v1/status", async () => buildSnapshot());

  app.register(async (instance) => {
    instance.get(config.controller.moduleWsPath, { websocket: true }, (socket) => {
      moduleGateway.attach(socket);
    });
  });

  app.register(async (instance) => {
    instance.get(config.controller.dashboardWsPath, { websocket: true }, (socket) => {
      dashboardHub.add(socket);
      socket.send(JSON.stringify({ type: "system.snapshot", data: buildSnapshot() }));
    });
  });

  const heartbeatMonitor = setInterval(() => {
    const degraded = registry.evaluateHeartbeats();
    for (const id of degraded) {
      eventLog.append({
        type: "module.degraded",
        summary: `Module ${id} missed heartbeats`,
        moduleId: id,
      });
    }
    if (degraded.length) publishSnapshot();
  }, Math.min(config.modules.heartbeatIntervalMs, 5000));

  app.addHook("onClose", async () => {
    clearInterval(heartbeatMonitor);
  });

  app.log.info("ECHO controller ready (pnpm dev:llm, pnpm dev:memory for Phase 3)");

  return { app, publishSnapshot, buildSnapshot };
}

export function resolveWebDist(): string | null {
  const candidate = resolve(__dirname, "../../web/dist");
  return candidate;
}

