import type { discordInboundMessageSchema } from "@echo/discord-contract";
import type { z } from "zod";
import type { CharacterCardStore } from "../characters/store.js";
import type { CognitiveEngine } from "../cognition/engine.js";
import type { EventLog } from "../persona/state.js";
import type { LlmBackend } from "../llm/llm-backend.js";
import type { DiscordModuleService } from "./discord-module-service.js";
import type { DiscordSettingsStore } from "./settings-store.js";
import { discordParticipant } from "./participant.js";
import { discordTextSessionId } from "./session-id.js";
import { evaluateDiscordRelevance } from "./relevance-gate.js";

type InboundMessage = z.infer<typeof discordInboundMessageSchema>;

type ChannelState = {
  guildId: string;
  channelId: string;
  /** Messages the persona skipped since last reply (capped). */
  skipped: InboundMessage[];
  /** Per-message gate / skip decisions in Discord order. */
  decisionChain: Promise<void>;
  /** Outbound replies — one at a time per channel, not blocked on gate latency. */
  replyChain: Promise<void>;
};

function formatMessagesForPrompt(messages: InboundMessage[]): string {
  return messages
    .map((m) => `${m.displayName}: ${m.content}`.trim())
    .filter(Boolean)
    .join("\n");
}

export class DiscordOrchestrator {
  private readonly channels = new Map<string, ChannelState>();
  private readonly voiceInterruptCounts = new Map<string, number>();

  constructor(
    private readonly settings: DiscordSettingsStore,
    private readonly discord: DiscordModuleService,
    private readonly engine: CognitiveEngine,
    private readonly characters: CharacterCardStore,
    private readonly llm: LlmBackend,
    private readonly eventLog: EventLog,
    private readonly gateTimeoutMs: number,
  ) {}

  enqueueInbound(msg: InboundMessage): void {
    const cfg = this.settings.load();
    if (!cfg.enabled) return;

    const channelPolicy = cfg.channels.find((c) => c.channelId === msg.channelId);
    if (channelPolicy && !channelPolicy.enabled) return;
    if (channelPolicy && !channelPolicy.textEnabled) return;
    if (cfg.guildId && msg.guildId !== cfg.guildId) return;

    const key = msg.channelId;
    let state = this.channels.get(key);
    if (!state) {
      state = {
        guildId: msg.guildId,
        channelId: msg.channelId,
        skipped: [],
        decisionChain: Promise.resolve(),
        replyChain: Promise.resolve(),
      };
      this.channels.set(key, state);
    }

    state.decisionChain = state.decisionChain
      .then(() => this.handleInboundMessage(state!, msg))
      .catch((err) => {
        this.eventLog.append({
          type: "discord.error",
          summary: `Discord message handling failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
  }

  private async handleInboundMessage(state: ChannelState, msg: InboundMessage): Promise<void> {
    const cfg = this.settings.load();
    const character = this.characters.getActive();
    if (!character) return;
    if (!this.engine.isChatAvailable()) return;

    const maxSkipped = cfg.batchMaxMessages;

    let shouldRespond =
      (cfg.alwaysRespondToMention && msg.mentionedBot) ||
      msg.referencedBotMessage;
    let gateReason = msg.referencedBotMessage
      ? "reply_to_bot"
      : msg.mentionedBot
        ? "mention"
        : "heuristic";

    if (!shouldRespond && cfg.relevanceGateEnabled) {
      const gate = await evaluateDiscordRelevance(
        this.llm,
        {
          character,
          channelLabel: `#${msg.channelId}`,
          currentMessage: `${msg.displayName}: ${msg.content}`,
          skippedContext:
            state.skipped.length > 0 ? formatMessagesForPrompt(state.skipped) : undefined,
          mentionedBot: msg.mentionedBot,
          referencedBot: msg.referencedBotMessage,
        },
        this.gateTimeoutMs,
        {
          onError: (message) => {
            this.eventLog.append({
              type: "discord.warn",
              summary: `Relevance gate LLM failed: ${message}`,
            });
          },
        },
      );
      shouldRespond = gate.shouldRespond;
      gateReason = gate.reason;
    } else if (!shouldRespond && !cfg.relevanceGateEnabled) {
      shouldRespond = true;
      gateReason = "gate_disabled";
    }

    if (!shouldRespond) {
      state.skipped.push(msg);
      while (state.skipped.length > maxSkipped) {
        state.skipped.shift();
      }
      this.eventLog.append({
        type: "discord.skip",
        summary: `Skipped message in ${msg.channelId} (${gateReason}); ${state.skipped.length} queued`,
      });
      return;
    }

    const batch = [...state.skipped, msg];
    state.skipped = [];
    state.replyChain = state.replyChain
      .then(() => this.respondToBatch(batch, gateReason))
      .catch((err) => {
        this.eventLog.append({
          type: "discord.error",
          summary: `Discord reply failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
  }

  private async respondToBatch(batch: InboundMessage[], gateReason: string): Promise<void> {
    const last = batch[batch.length - 1]!;
    const batchedUserText = formatMessagesForPrompt(batch);

    const speaker = discordParticipant(last.guildId, last.userId, last.displayName);
    const sessionId = discordTextSessionId(last.guildId, last.channelId);

    this.eventLog.append({
      type: "discord.inbound",
      summary: `Discord reply (${batch.length} msg(s), ${gateReason}) → #${last.channelId}`,
    });

    const result = await this.engine.chat({
      message: batchedUserText,
      sessionId,
      speaker,
      stream: false,
    });

    if (!this.discord.isAvailable()) {
      this.eventLog.append({
        type: "discord.warn",
        summary: "Reply generated but Discord module offline",
      });
      return;
    }

    await this.discord.sendMessage({
      channelId: last.channelId,
      content: result.reply.slice(0, 2000),
      replyToMessageId: last.messageId,
    });

    this.eventLog.append({
      type: "discord.outbound",
      summary: `Sent reply to #${last.channelId} (${result.reply.length} chars)`,
    });
  }

  /** Voice transcript from Discord module (after STT) — optional chat + speak back. */
  async handleVoiceTranscript(input: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
    text: string;
    final: boolean;
  }): Promise<void> {
    if (!input.final || !input.text.trim()) return;
    const cfg = this.settings.load();
    if (!cfg.enabled) return;

    const speaker = discordParticipant(input.guildId, input.userId, input.displayName);
    const sessionId = discordTextSessionId(input.guildId, input.channelId);

    const result = await this.engine.chat({
      message: `[voice] ${input.text}`,
      sessionId,
      speaker,
      stream: false,
    });

    if (this.discord.isAvailable()) {
      await this.discord.speakInVoice({
        guildId: input.guildId,
        channelId: input.channelId,
        text: result.reply,
      });
    }
  }

  /** Called when a user interrupts TTS in voice. */
  async handleVoiceInterrupt(input: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
  }): Promise<void> {
    const cfg = this.settings.load();
    const key = `${input.guildId}:${input.channelId}`;
    const count = (this.voiceInterruptCounts.get(key) ?? 0) + 1;
    this.voiceInterruptCounts.set(key, count);

    this.eventLog.append({
      type: "discord.voice",
      summary: `${input.displayName} interrupted bot speech (${count}x)`,
    });

    if (this.discord.isAvailable()) {
      await this.discord.cancelVoiceSpeak({
        guildId: input.guildId,
        channelId: input.channelId,
      });
    }

    if (count >= cfg.voiceInterruptAnnoyanceThreshold && this.engine.isChatAvailable()) {
      const character = this.characters.getActive();
      if (!character) return;
      const sessionId = discordTextSessionId(input.guildId, input.channelId);
      const speaker = discordParticipant(input.guildId, input.userId, input.displayName);
      const result = await this.engine.chat({
        message: `[voice] ${input.displayName} keeps talking over you while you were speaking. React briefly in character to being interrupted.`,
        sessionId,
        speaker,
        stream: false,
      });
      if (this.discord.isAvailable()) {
        await this.discord.speakInVoice({
          guildId: input.guildId,
          channelId: input.channelId,
          text: result.reply,
        });
      }
      this.voiceInterruptCounts.set(key, 0);
    }
  }
}
