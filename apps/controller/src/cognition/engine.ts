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
import { buildToolRouting } from "./tools.js";
import type { MemoryModuleService } from "../memory/memory-module-service.js";
import type { MemoryCurator } from "../memory/memory-curator.js";
import type { EpisodeCompactor } from "../memory/episode-compactor.js";
import type { ParticipantRef } from "../memory/participant.js";
import type { TtsModuleService } from "../tts/tts-module-service.js";
import { SpeechStreamPipeline } from "../tts/speech-pipeline.js";
import { resolveSpeechOutputPlan, type TtsSink } from "../tts/speech-origin.js";
import { formatAssistantTurnMessages, formatLlmOutput } from "../llm/output-format.js";
import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import { TIME_CAPABILITIES } from "@echo/time-contract";
import { applyDiscordSessionToolDefaults } from "../discord/discord-tool-defaults.js";
import { describeOperationalError } from "../util/operational-error.js";
import { buildDiscordChannelPrompt } from "../discord/discord-session-prompt.js";
import { discordSessionToolExclusions } from "../discord/discord-tool-policy.js";
import { getDiscordDeliveryForSession } from "../discord/session-delivery.js";
import { expandPersonaPlaceholders, normalizeMemoryProse } from "../persona/placeholders.js";

export type CognitiveEngineConfig = {
  maxToolIterations: number;
  requestTimeoutMs: number;
  moduleRequestTimeoutMs: number;
  /** Recent messages passed verbatim to the LLM when memory module is active. */
  promptHistoryMessages?: number;
  memoryRetrievalTokenBudget?: number;
  memoryRetrievalMaxItems?: number;
  /** Max messages loaded from Postgres when hydrating an empty in-memory session. */
  sessionHydrationLimit?: number;
};

export class CognitiveEngine {
  private readonly sessions = new SessionStore();
  private activeTasks = new Map<string, AbortController>();

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
    private readonly tts: TtsModuleService | null = null,
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

  cancelTask(taskId: string, reason = "cancelTask called"): boolean {
    const controller = this.activeTasks.get(taskId);
    if (!controller) return false;
    controller.abort(new DOMException(reason, "AbortError"));
    this.activeTasks.delete(taskId);
    this.eventLog.append({
      type: "cognition.abort",
      summary: `Chat task ${taskId.slice(0, 8)}… cancelled: ${reason}`,
    });
    return true;
  }

  async chat(input: {
    message: string;
    sessionId?: string;
    taskId?: string;
    speaker?: ParticipantRef;
    stream?: boolean;
    /** When set (or inferred from twitch:/stt: speakers), LLM streams sentences to the TTS module. */
    speechOutput?: {
      force?: boolean;
      disable?: boolean;
      sink?: TtsSink;
      streamId?: string;
    };
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

    const session = this.sessions.getOrCreate(input.sessionId);
    const taskId = input.taskId ?? crypto.randomUUID();
    const abort = new AbortController();
    this.activeTasks.set(taskId, abort);
    input.onStarted?.({ taskId, sessionId: session.id });

    const provider = await this.llm.createActiveProvider();

    this.setPersonaState({
      activity: "thinking",
      focus: "conversation",
      activeProvider: provider.id,
      activeModel: provider.model,
      pendingActions: this.activeTasks.size,
    });

    const character = this.characters.getActive();
    if (!character) {
      throw new Error("No active character card. Create or activate a character in the dashboard.");
    }

    const discordDelivery = getDiscordDeliveryForSession(session.id);
    const discordToolExclusions = discordDelivery
      ? discordSessionToolExclusions(discordDelivery.mode)
      : undefined;
    const { tools, toolNameToCapabilityId } = buildToolRouting(
      this.moduleRegistry.snapshot().modules.flatMap((m) => m.capabilities),
      discordToolExclusions ? { excludeCapabilityIds: discordToolExclusions } : undefined,
    );

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
          characterDisplayName: character.name,
          speaker: input.speaker,
          query: input.message,
          tokenBudget: this.config.memoryRetrievalTokenBudget ?? 2048,
          maxItems: this.config.memoryRetrievalMaxItems ?? 12,
        });
        memoryInjection = normalizeMemoryProse(
          expandPersonaPlaceholders(retrieved.injectedText, { characterName: character.name }),
          character.name,
        );
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

    const discordInjection = discordDelivery ? buildDiscordChannelPrompt(discordDelivery) : "";
    const combinedInjection = [memoryInjection, discordInjection].filter(Boolean).join("\n\n");

    const messages = assembleChatMessages({
      character,
      policy: this.runtimePolicy,
      state: this.getPersonaState(),
      history: this.sessions.history(session.id),
      userMessage: input.speaker
        ? `[${input.speaker.displayName}] ${input.message}`
        : input.message,
      memoryInjection: combinedInjection || undefined,
      historyLimit: memoryAvailable ? this.config.promptHistoryMessages ?? 24 : undefined,
    });

    this.eventLog.append({
      type: "chat.user",
      summary: `User message (${input.message.slice(0, 80)}${input.message.length > 80 ? "…" : ""})`,
    });

    const ttsDisabledForDiscordText = discordDelivery?.mode === "text";
    const speechPlan = this.tts?.isAvailable()
      ? resolveSpeechOutputPlan({
          speaker: input.speaker,
          streamId: input.speechOutput?.streamId ?? taskId,
          sink: input.speechOutput?.sink,
          force: input.speechOutput?.force,
          disable: input.speechOutput?.disable ?? ttsDisabledForDiscordText,
        })
      : null;

    const speechPipeline =
      speechPlan && this.tts ? new SpeechStreamPipeline(this.tts, speechPlan) : null;
    const llmStream = speechPipeline ? true : (input.stream ?? true);

    try {
      const result = await runCognitiveLoop({
        messages,
        stream: llmStream,
        signal: abort.signal,
        onStream: (ev) => {
          if (ev.type === "text-delta") input.onStream?.(formatLlmOutput(ev.delta));
        },
        options: {
          provider,
          tools,
          maxIterations: this.config.maxToolIterations,
          requestTimeoutMs: this.config.requestTimeoutMs,
          onEvent: (ev) => {
            input.onTrace?.(ev);
            if (ev.type === "model.delta" && speechPipeline) {
              void speechPipeline.onDelta(ev.delta);
            }
            if (ev.type === "tool.start") {
              this.eventLog.append({
                type: "tool.start",
                summary: `${ev.name} → ${ev.capabilityId}`,
              });
            }
            if (ev.type === "tool.error" || ev.type === "loop.error") {
              this.eventLog.append({
                type: "cognition.warn",
                summary: ev.detail,
              });
            }
            if (ev.type === "tool.end" && !ev.ok) {
              this.eventLog.append({
                type: "tool.error",
                summary: `${ev.name} → ${ev.capabilityId} failed`,
              });
            }
          },
          resolveCapabilityId: (toolName) => toolNameToCapabilityId.get(toolName) ?? toolName,
          invokeModule: async (capabilityId, params, opts) => {
            let payload = params;
            const discordSession = getDiscordDeliveryForSession(session.id);
            if (discordSession) {
              payload = applyDiscordSessionToolDefaults(capabilityId, payload, discordSession);
            }
            if (capabilityId === TIME_CAPABILITIES.TIMER_CREATE) {
              const base =
                typeof params === "object" && params !== null
                  ? { ...(params as Record<string, unknown>) }
                  : {};
              base.sessionId = base.sessionId ?? session.id;
              base.personaId = base.personaId ?? character.id;
              const discord = getDiscordDeliveryForSession(session.id);
              if (discord && !base.notifyDiscord) {
                base.notifyDiscord = {
                  channelId: discord.channelId,
                  guildId: discord.guildId,
                };
              }
              const guildId =
                (base.notifyDiscord as { guildId?: string } | undefined)?.guildId ?? discord?.guildId;
              const mentionIds = new Set<string>(
                Array.isArray(base.mentionUserIds)
                  ? (base.mentionUserIds as string[]).filter((id) => typeof id === "string" && id.trim())
                  : [],
              );
              const mentionNames = Array.isArray(base.mentionUsernames)
                ? (base.mentionUsernames as string[]).filter((n) => typeof n === "string" && n.trim())
                : [];
              if (guildId && mentionNames.length > 0) {
                for (const name of mentionNames) {
                  try {
                    const resolved = (await this.moduleGateway.invokeCapability(
                      DISCORD_CAPABILITIES.MEMBER_RESOLVE,
                      { guildId, query: name },
                      { timeoutMs: this.config.moduleRequestTimeoutMs },
                    )) as { matches?: { userId: string }[] };
                    const first = resolved.matches?.[0];
                    if (first?.userId) mentionIds.add(first.userId);
                  } catch {
                    // Discord offline or member not found
                  }
                }
              }
              if (mentionIds.size > 0) {
                base.mentionUserIds = [...mentionIds];
              }
              delete base.mentionUsernames;
              payload = base;
            }
            const voiceCap = capabilityId.startsWith("discord.voice.");
            const timeoutMs =
              capabilityId === DISCORD_CAPABILITIES.VOICE_JOIN
                ? Math.max(this.config.moduleRequestTimeoutMs, 90_000)
                : this.config.moduleRequestTimeoutMs;
            return this.moduleGateway.invokeCapability(capabilityId, payload, {
              // Voice join can take 20s+; do not tie to chat abort (avoids spurious "operation was aborted").
              signal: voiceCap ? undefined : opts?.signal,
              timeoutMs,
              taskId,
            });
          },
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
          characterName: character.name,
          sessionId: session.id,
          turnId: taskId,
          speaker: input.speaker,
          userMessage: input.message,
          assistantReply: reply,
        });

        this.episodeCompactor?.afterTurn({
          personaId: character.id,
          characterName: character.name,
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
      const { logLine } = describeOperationalError(err, {
        operation: "chat",
        taskId,
        sessionId: session.id,
        timeoutMs: this.config.requestTimeoutMs,
      });
      this.eventLog.append({ type: "cognition.error", summary: logLine });
      this.setPersonaState({
        activity: "idle",
        focus: "conversation",
        pendingActions: Math.max(0, this.activeTasks.size - 1),
        lastEventSummary: logLine.slice(0, 200),
      });
      throw err instanceof Error ? err : new Error(logLine);
    } finally {
      if (speechPipeline) {
        await speechPipeline.flush().catch(() => {});
      }
      this.activeTasks.delete(taskId);
    }
  }
}

