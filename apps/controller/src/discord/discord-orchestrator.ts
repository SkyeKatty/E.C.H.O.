import type { discordInboundMessageSchema } from "@echo/discord-contract";
import type { z } from "zod";
import type { CharacterCardStore } from "../characters/store.js";
import type { CognitiveEngine } from "../cognition/engine.js";
import type { EventLog } from "../persona/state.js";
import type { LlmBackend } from "../llm/llm-backend.js";
import type { DiscordModuleService } from "./discord-module-service.js";
import type { DiscordSettingsStore } from "./settings-store.js";
import { discordParticipant } from "./participant.js";
import { registerDiscordSession } from "./session-delivery.js";
import { discordTextSessionId } from "./session-id.js";
import { evaluateDiscordRelevance } from "./relevance-gate.js";

type InboundMessage = z.infer<typeof discordInboundMessageSchema>;

/** Extra channel lines included before the “since last reply” backlog. */
const PRIOR_BEFORE_BACKLOG = 3;

type ChannelState = {
  guildId: string;
  channelId: string;
  /** All inbound messages since the persona’s last reply in this channel (skipped or not). */
  sinceLastReply: InboundMessage[];
  /** Rolling channel timeline (users + persona replies), ordered by `createdAt`. */
  recentInbound: InboundMessage[];
  /** Reaction / activity lines shown on the next gate or reply turn. */
  pendingActivity: string[];
  /** Per-message gate / skip decisions in Discord order. */
  decisionChain: Promise<void>;
  /** Outbound replies — one at a time per channel, not blocked on gate latency. */
  replyChain: Promise<void>;
};

function formatInboundLine(m: InboundMessage): string {
  let line = `${m.displayName}: ${m.content}`.trim();
  if (m.replyTo) {
    line += `\n  ↳ replying to ${m.replyTo.authorDisplayName}: "${m.replyTo.content.replace(/\n/g, " ").slice(0, 500)}"`;
  }
  if (m.mentionedUsers?.length) {
    const names = m.mentionedUsers.map((u) => u.displayName ?? u.username).join(", ");
    line += `\n  (mentions: ${names})`;
  }
  return line;
}

function formatMessagesForPrompt(messages: InboundMessage[]): string {
  return messages.map(formatInboundLine).filter(Boolean).join("\n");
}

function consumePendingActivity(state: ChannelState): string | undefined {
  if (state.pendingActivity.length === 0) return undefined;
  const lines = state.pendingActivity.splice(0, state.pendingActivity.length);
  return lines.join("\n");
}

function timelineOrder(a: InboundMessage, b: InboundMessage): number {
  const ta = a.createdAt ?? "";
  const tb = b.createdAt ?? "";
  if (ta !== tb) return ta.localeCompare(tb);
  return a.messageId.localeCompare(b.messageId);
}

function sortedTimeline(messages: InboundMessage[]): InboundMessage[] {
  return [...messages].sort(timelineOrder);
}

/** Up to `priorCount` lines before the backlog, the backlog, and any persona lines between them. */
function buildContextWindow(
  recent: InboundMessage[],
  backlog: InboundMessage[],
  priorCount: number,
): InboundMessage[] {
  const ordered = sortedTimeline(recent);
  if (backlog.length === 0) {
    return priorCount > 0 ? ordered.slice(-priorCount) : [];
  }
  const backlogIds = new Set(backlog.map((m) => m.messageId));
  const firstIdx = ordered.findIndex((m) => backlogIds.has(m.messageId));
  if (firstIdx < 0) return backlog;
  const start = Math.max(0, firstIdx - priorCount);
  const lastId = backlog[backlog.length - 1]!.messageId;
  const lastIdx = ordered.findIndex((m) => m.messageId === lastId);
  const end = lastIdx >= 0 ? lastIdx : ordered.length - 1;
  return ordered.slice(start, end + 1);
}

function withReceivedAt(msg: InboundMessage): InboundMessage {
  return msg.createdAt ? msg : { ...msg, createdAt: new Date().toISOString() };
}

function trimInboundBuffer(messages: InboundMessage[], max: number): void {
  while (messages.length > max) {
    messages.shift();
  }
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

  enqueueActivity(input: { guildId: string; channelId: string; text: string }): void {
    const cfg = this.settings.load();
    if (!cfg.enabled) return;
    if (cfg.guildId && input.guildId !== cfg.guildId) return;

    const key = input.channelId;
    let state = this.channels.get(key);
    if (!state) {
      state = {
        guildId: input.guildId,
        channelId: input.channelId,
        sinceLastReply: [],
        recentInbound: [],
        pendingActivity: [],
        decisionChain: Promise.resolve(),
        replyChain: Promise.resolve(),
      };
      this.channels.set(key, state);
    }
    state.pendingActivity.push(input.text);
    while (state.pendingActivity.length > 12) {
      state.pendingActivity.shift();
    }
  }

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
        sinceLastReply: [],
        recentInbound: [],
        pendingActivity: [],
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

    msg = withReceivedAt(msg);
    registerDiscordSession(
      discordTextSessionId(msg.guildId, msg.channelId),
      msg.guildId,
      msg.channelId,
    );

    const maxBacklog = cfg.batchMaxMessages;
    const backlog = state.sinceLastReply;
    const activityPrefix = consumePendingActivity(state);
    const contextWindow = buildContextWindow(state.recentInbound, backlog, PRIOR_BEFORE_BACKLOG);
    let gateContext =
      contextWindow.length > 0 ? formatMessagesForPrompt(contextWindow) : undefined;
    if (activityPrefix) {
      gateContext = gateContext
        ? `[Recent channel activity]\n${activityPrefix}\n\n${gateContext}`
        : `[Recent channel activity]\n${activityPrefix}`;
    }

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
          currentMessage: formatInboundLine(msg),
          skippedContext: gateContext,
          mentionedBot: msg.mentionedBot,
          referencedBot: msg.referencedBotMessage,
        },
        this.gateTimeoutMs,
      );
      shouldRespond = gate.shouldRespond;
      gateReason = gate.reason;
    } else if (!shouldRespond && !cfg.relevanceGateEnabled) {
      shouldRespond = true;
      gateReason = "gate_disabled";
    }

    if (!shouldRespond) {
      state.sinceLastReply.push(msg);
      trimInboundBuffer(state.sinceLastReply, maxBacklog);
      state.recentInbound.push(msg);
      trimInboundBuffer(state.recentInbound, maxBacklog + PRIOR_BEFORE_BACKLOG + 16);
      this.eventLog.append({
        type: "discord.skip",
        summary: `Skipped message in ${msg.channelId} (${gateReason}); backlog ${state.sinceLastReply.length}`,
      });
      return;
    }

    const batchMessages = [...contextWindow, msg];
    const batch = activityPrefix
      ? ([
          {
            messageId: `activity-${Date.now()}`,
            guildId: msg.guildId,
            channelId: msg.channelId,
            userId: "system",
            displayName: "Channel activity",
            content: activityPrefix,
            mentionedBot: false,
            referencedBotMessage: false,
          } satisfies InboundMessage,
          ...batchMessages,
        ] as InboundMessage[])
      : batchMessages;
    state.sinceLastReply = [];
    state.recentInbound.push(msg);
    trimInboundBuffer(state.recentInbound, maxBacklog + PRIOR_BEFORE_BACKLOG + 16);
    state.replyChain = state.replyChain
      .then(() => this.respondToBatch(state, batch, gateReason))
      .catch((err) => {
        this.eventLog.append({
          type: "discord.error",
          summary: `Discord reply failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
  }

  private recordPersonaReply(
    state: ChannelState,
    input: {
      messageId: string;
      guildId: string;
      channelId: string;
      displayName: string;
      content: string;
      after: InboundMessage;
    },
  ): void {
    let createdAt = new Date().toISOString();
    if (input.after.createdAt) {
      createdAt = new Date(new Date(input.after.createdAt).getTime() + 1).toISOString();
    }
    state.recentInbound.push({
      messageId: input.messageId,
      guildId: input.guildId,
      channelId: input.channelId,
      userId: "persona",
      displayName: input.displayName,
      content: input.content,
      mentionedBot: false,
      referencedBotMessage: false,
      createdAt,
    });
    trimInboundBuffer(state.recentInbound, 64);
  }

  private async respondToBatch(
    state: ChannelState,
    batch: InboundMessage[],
    gateReason: string,
  ): Promise<void> {
    const last = batch[batch.length - 1]!;
    const batchedUserText = formatMessagesForPrompt(batch);

    const speaker = discordParticipant(last.guildId, last.userId, last.displayName);
    const sessionId = discordTextSessionId(last.guildId, last.channelId);
    const character = this.characters.getActive();

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

    const content = result.reply.slice(0, 2000);
    const sent = (await this.discord.sendMessage({
      channelId: last.channelId,
      content,
      replyToMessageId: last.messageId,
    })) as { messageId?: string };

    if (sent.messageId) {
      this.recordPersonaReply(state, {
        messageId: sent.messageId,
        guildId: last.guildId,
        channelId: last.channelId,
        displayName: character?.name ?? "Persona",
        content,
        after: last,
      });
    }

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
