import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";
import type { LlmBackend } from "../llm/llm-backend.js";
import type { CharacterCardStore } from "../characters/store.js";
import type { RuntimePersonaPolicy } from "../characters/prompt.js";
import type { PersonaOperationalState } from "../persona/state.js";
import type { EventLog } from "../persona/state.js";
import { assembleChatMessages } from "./context.js";
import { runCognitiveLoop, type CognitiveTraceEvent } from "./loop.js";
import { SessionStore } from "./session-store.js";
import {
  buildToolRouting,
  isDiscordCapabilityId,
  normalizeDiscordCapabilityId,
  resolveToolCapabilityId,
} from "./tools.js";
import type { DiscordModuleService } from "../discord/discord-module-service.js";
import type { MemoryModuleService } from "../memory/memory-module-service.js";
import type { MemoryCurator } from "../memory/memory-curator.js";
import type { EpisodeCompactor } from "../memory/episode-compactor.js";
import type { ParticipantRef } from "../memory/participant.js";
import { formatAssistantTurnMessages, formatLlmOutput } from "../llm/output-format.js";

export type CognitiveEngineConfig = {
  maxToolIterations: number;
  requestTimeoutMs: number;
  moduleRequestTimeoutMs: number;
  /** Discord channel names/ids appended to the system prompt when available. */
  fetchDiscordPromptContext?: () => Promise<string | undefined>;
  /** Recent messages passed verbatim to the LLM when memory module is active. */
  promptHistoryMessages?: number;
  memoryRetrievalTokenBudget?: number;
  memoryRetrievalMaxItems?: number;
  /** Max messages loaded from Postgres when hydrating an empty in-memory session. */
  sessionHydrationLimit?: number;
  /** Discord tool RPCs (voice join, etc.) — not cancelled when chat stops. */
  discordModule?: DiscordModuleService | null;
};

export class CognitiveEngine {
  private readonly sessions = new SessionStore();
  private activeTasks = new Map<string, AbortController>();
  /** One turn at a time per session — later messages wait (voice join must finish). */
  private readonly sessionTurnTail = new Map<string, Promise<unknown>>();

  constructor(
    private readonly llm: LlmBackend,
    private readonly moduleRegistry: ModuleRegistry,
    private readonly moduleGateway: ModuleGateway,
    private readonly characters: CharacterCardStore,
    private readonly runtimePolicy: RuntimePersonaPolicy,
    private readonly getPersonaState: () => PersonaOperationalState,
    private readonly setPersonaState: (patch: Partial<PersonaOperationalState>) => void,
    private readonly eventLog: EventLog,
    private readonly config: CognitiveEngineConfig,
    private readonly memory: MemoryModuleService | null = null,
    private readonly memoryCurator: MemoryCurator | null = null,
    private readonly episodeCompactor: EpisodeCompactor | null = null,
  ) {}

  isChatAvailable(): boolean {
    return this.llm.isAvailable();
  }

  async listProviders() {
    if (!this.llm.isAvailable()) return [];
    return this.llm.listProviders();
  }

  async getActiveProviderId() {
    if (!this.llm.isAvailable()) return null;
    return this.llm.getActiveProviderId();
  }

  async setActiveProvider(id: string) {
    const data = await this.llm.updateSettings({ activeProviderId: id });
    const profile = data.settings.providers.find((p) => p.id === data.settings.activeProviderId);
    this.setPersonaState({
      activeProvider: data.settings.activeProviderId,
      activeModel: profile?.model ?? null,
    });
    this.eventLog.append({
      type: "cognition.provider",
      summary: `Active LLM provider set to ${profile?.label ?? id} (${profile?.model ?? "?"})`,
    });
    return this.llm.listProviders();
  }

  async getPersistedHistory(sessionId: string): Promise<{
    messages: {
      id: string;
      role: string;
      content: string | null;
      speakerDisplayName?: string | null;
    }[];
  }> {
    if (!this.memory?.isAvailable()) return { messages: [] };
    const character = this.characters.getActive();
    if (!character) return { messages: [] };
    const limit = this.config.sessionHydrationLimit ?? 80;
    const listed = await this.memory.listConversation({
      personaId: character.id,
      sessionId,
      limit,
    });
    return {
      messages: listed.messages.filter((m) => m.role === "user" || m.role === "assistant"),
    };
  }

  cancelTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    if (!controller) return false;
    controller.abort();
    this.activeTasks.delete(taskId);
    return true;
  }

  async chat(input: {
    message: string;
    sessionId?: string;
    taskId?: string;
    speaker?: ParticipantRef;
    stream?: boolean;
    providerId?: string;
    generation?: { temperature?: number; maxTokens?: number };
    onStream?: (chunk: string) => void;
    onTrace?: (ev: CognitiveTraceEvent) => void;
    onStarted?: (meta: { taskId: string; sessionId: string }) => void;
  }): Promise<{
    sessionId: string;
    taskId: string;
    reply: string;
    providerId: string;
    model: string;
    usage?: { totalTokens?: number };
  }> {
    if (!this.llm.isAvailable()) {
      throw new Error(
        this.llm.adapter === "embedded"
          ? "LLM runtime is unavailable."
          : "LLM module is not connected. Start the LLM module (pnpm dev:llm) or set cognition.llmAdapter: embedded.",
      );
    }

    const session = this.sessions.getOrCreate(input.sessionId);
    const sessionKey = session.id;
    const prev = this.sessionTurnTail.get(sessionKey) ?? Promise.resolve();
    const turn = prev.catch(() => undefined).then(() => this.runChatTurn(input, session));
    this.sessionTurnTail.set(sessionKey, turn);
    return turn as ReturnType<CognitiveEngine["runChatTurn"]>;
  }

  private async runChatTurn(
    input: {
      message: string;
      sessionId?: string;
      taskId?: string;
      speaker?: ParticipantRef;
      stream?: boolean;
      providerId?: string;
      generation?: { temperature?: number; maxTokens?: number };
      onStream?: (chunk: string) => void;
      onTrace?: (ev: CognitiveTraceEvent) => void;
      onStarted?: (meta: { taskId: string; sessionId: string }) => void;
    },
    session: ReturnType<SessionStore["getOrCreate"]>,
  ): Promise<{
    sessionId: string;
    taskId: string;
    reply: string;
    providerId: string;
    model: string;
    usage?: { totalTokens?: number };
  }> {
    if (input.providerId) {
      await this.setActiveProvider(input.providerId);
    }

    if (input.generation) {
      const { settings } = await this.llm.getSettings();
      const active = settings.activeProviderId;
      await this.llm.updateSettings({
        profile: {
          id: active,
          generation: input.generation,
        },
      });
    }

    const taskId = input.taskId ?? crypto.randomUUID();
    const abort = new AbortController();
    this.activeTasks.set(taskId, abort);
    input.onStarted?.({ taskId, sessionId: session.id });

    const provider = await this.llm.createProviderForTask("chat");

    this.setPersonaState({
      activity: "thinking",
      focus: "conversation",
      activeProvider: provider.id,
      activeModel: provider.model,
      pendingActions: this.activeTasks.size,
    });

    const { tools, toolNameToCapabilityId } = buildToolRouting(
      this.moduleRegistry.snapshot().modules.flatMap((m) => m.capabilities),
    );

    const character = this.characters.getActive();
    if (!character) {
      throw new Error("No active character card. Create or activate a character in the dashboard.");
    }

    const memoryAvailable = this.memory?.isAvailable() ?? false;
    if (memoryAvailable && this.sessions.isEmpty(session.id)) {
      try {
        const listed = await this.memory!.listConversation({
          personaId: character.id,
          sessionId: session.id,
          limit: this.config.sessionHydrationLimit ?? 80,
        });
        if (listed.messages.length) {
          this.sessions.replaceHistory(
            session.id,
            listed.messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system" | "tool",
              content: m.content,
            })),
          );
        }
      } catch (err) {
        this.eventLog.append({
          type: "memory.warn",
          summary: `Could not hydrate session history: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }

    let memoryInjection = "";
    if (memoryAvailable) {
      try {
        if (!input.speaker) {
          this.eventLog.append({
            type: "memory.warn",
            summary: "No speaker identity on chat turn; memories may stay candidate until speaker is set",
          });
        }
        const retrieved = await this.memory!.retrieveContext({
          personaId: character.id,
          sessionId: session.id,
          speaker: input.speaker,
          query: input.message,
          tokenBudget: this.config.memoryRetrievalTokenBudget ?? 2048,
          maxItems: this.config.memoryRetrievalMaxItems ?? 12,
        });
        memoryInjection = retrieved.injectedText;
        if (retrieved.truncated) {
          this.eventLog.append({
            type: "memory.retrieve",
            summary: `Memory context truncated (${retrieved.estimatedTokens}/${retrieved.tokenBudget} tokens)`,
          });
        }
      } catch (err) {
        this.eventLog.append({
          type: "memory.warn",
          summary: `Memory retrieval skipped: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }

    let discordInjection: string | undefined;
    if (this.config.fetchDiscordPromptContext) {
      try {
        discordInjection = await this.config.fetchDiscordPromptContext();
      } catch {
        discordInjection = undefined;
      }
    }

    const messages = assembleChatMessages({
      character,
      policy: this.runtimePolicy,
      state: this.getPersonaState(),
      history: this.sessions.history(session.id),
      userMessage: input.speaker
        ? `[${input.speaker.displayName}] ${input.message}`
        : input.message,
      discordInjection,
      memoryInjection,
      historyLimit: memoryAvailable ? this.config.promptHistoryMessages ?? 24 : undefined,
    });

    this.eventLog.append({
      type: "chat.user",
      summary: `User message (${input.message.slice(0, 80)}${input.message.length > 80 ? "…" : ""})`,
    });

    try {
      const result = await runCognitiveLoop({
        messages,
        stream: input.stream ?? true,
        signal: abort.signal,
        onStream: (ev) => {
          if (ev.type === "text-delta") input.onStream?.(formatLlmOutput(ev.delta));
        },
        options: {
          provider,
          tools,
          maxIterations: this.config.maxToolIterations,
          requestTimeoutMs: this.config.requestTimeoutMs,
          resolveCapabilityId: (toolName) =>
            resolveToolCapabilityId(toolName, toolNameToCapabilityId),
          invokeModule: (capabilityId, params) => {
            const normalized = normalizeDiscordCapabilityId(capabilityId);
            if (isDiscordCapabilityId(normalized) && this.config.discordModule?.isAvailable()) {
              return this.config.discordModule.invokeSideEffect(normalized, params);
            }
            return this.moduleGateway.invokeCapability(normalized, params, {
              revocable: !isDiscordCapabilityId(normalized),
              timeoutMs: isDiscordCapabilityId(normalized)
                ? Math.max(this.config.moduleRequestTimeoutMs, 120_000)
                : this.config.moduleRequestTimeoutMs,
              timeoutGraceMs: isDiscordCapabilityId(normalized) ? 45_000 : undefined,
            });
          },
          onEvent: input.onTrace,
        },
      });

      const storedTurn = formatAssistantTurnMessages(result.newMessages);
      this.sessions.append(session.id, { role: "user", content: input.message }, ...storedTurn);

      const reply = formatLlmOutput(result.assistantMessage.content ?? "");

      if (memoryAvailable) {
        try {
          await this.memory!.appendConversation({
            personaId: character.id,
            sessionId: session.id,
            speaker: input.speaker,
            messages: [
              { idempotencyKey: `${taskId}:user`, role: "user", content: input.message },
              { idempotencyKey: `${taskId}:assistant`, role: "assistant", content: reply },
            ],
          });
        } catch (err) {
          this.eventLog.append({
            type: "memory.warn",
            summary: `Failed to persist conversation: ${err instanceof Error ? err.message : "unknown"}`,
          });
        }

        this.memoryCurator?.processTurn({
          personaId: character.id,
          sessionId: session.id,
          turnId: taskId,
          speaker: input.speaker,
          userMessage: input.message,
          assistantReply: reply,
        });

        this.episodeCompactor?.afterTurn({
          personaId: character.id,
          sessionId: session.id,
          turnId: taskId,
        });
      }
      const usageNote =
        result.usage?.totalTokens != null ? ` · ${result.usage.totalTokens} tokens` : "";
      this.eventLog.append({
        type: "chat.assistant",
        summary: `Assistant reply (${reply.slice(0, 80)}${reply.length > 80 ? "…" : ""})${usageNote}`,
      });
      if (result.usage?.totalTokens != null) {
        this.eventLog.append({
          type: "cognition.usage",
          summary: `LLM usage: ${result.usage.totalTokens} tokens (${result.providerId}/${result.model})`,
        });
      }

      this.setPersonaState({
        activity: "idle",
        focus: "conversation",
        pendingActions: Math.max(0, this.activeTasks.size - 1),
        lastEventSummary: "Completed chat turn",
      });

      return {
        sessionId: session.id,
        taskId,
        reply,
        providerId: result.providerId,
        model: result.model,
        usage: result.usage,
      };
    } catch (err) {
      this.setPersonaState({
        activity: "idle",
        focus: "conversation",
        pendingActions: Math.max(0, this.activeTasks.size - 1),
        lastEventSummary: err instanceof Error ? err.message : "Chat failed",
      });
      throw err;
    } finally {
      this.activeTasks.delete(taskId);
    }
  }
}

