import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type VoiceBasedChannel,
} from "discord.js";
import {
  DISCORD_CAPABILITIES,
  discordConfigApplySchema,
  discordMessageSendSchema,
  discordVoiceJoinRefSchema,
  discordVoiceLeaveRefSchema,
  discordChannelsListSchema,
  discordVoiceSpeakSchema,
  type DiscordChannelsList,
  discordMessageSendToolSchema,
  discordVoiceChannelToolSchema,
  discordVoiceLeaveToolSchema,
  type DiscordRuntimeConfig,
} from "@echo/discord-contract";
import { ControllerClient } from "./controller-client.js";
import { discordConnectionFingerprint, needsDiscordReconnect } from "./config-fingerprint.js";
import {
  destroyDiscordClient,
  DiscordRateLimitError,
  invalidateTokenVerifyCache,
  loginDiscordClient,
} from "./gateway-connect.js";
import { VoiceManager } from "./voice-manager.js";
import { pickVoiceChannel } from "./channel-resolver.js";

export type GatewayStatus = "offline" | "connecting" | "online" | "error";

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && /abort/i.test(err.message);
}

async function withAbortRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < tries - 1 && isAbortLike(err)) {
        await new Promise((r) => setTimeout(r, 200 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw last;
}

function resolveGuildId(cfg: DiscordRuntimeConfig | null, guildId?: string): string {
  const g = guildId?.trim() || cfg?.guildId?.trim();
  if (!g) {
    throw new Error(
      "guildId is required — pass it in the tool call or set Guild ID in Discord dashboard settings",
    );
  }
  return g;
}

export class DiscordRuntime {
  private client: Client | null = null;
  private config: DiscordRuntimeConfig | null = null;
  private connectionFingerprint: string | null = null;
  private applyMutex: Promise<void> = Promise.resolve();
  private reconnectTask: Promise<void> | null = null;
  private rateLimitRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private gatewayStatus: GatewayStatus = "offline";
  private lastGatewayError: string | null = null;
  private lastAppliedTokenFingerprint: string | null = null;
  private readonly voice = new VoiceManager();
  private readonly controller: ControllerClient;
  private channelListCache: { at: number; data: DiscordChannelsList } | null = null;
  /** Serialize guild REST work (avoids discord.js aborting overlapping fetches). */
  private guildOpChain: Promise<void> = Promise.resolve();

  constructor(controllerBaseUrl: string, authToken?: string) {
    this.controller = new ControllerClient(controllerBaseUrl, authToken);
  }

  private runGuildOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.guildOpChain.then(fn, fn);
    this.guildOpChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  getStatus() {
    const ready = Boolean(this.client?.isReady());
    if (ready) this.gatewayStatus = "online";
    return {
      enabled: this.config?.enabled ?? false,
      loggedIn: ready,
      gatewayStatus: this.gatewayStatus,
      lastGatewayError: this.lastGatewayError,
      guildId: this.config?.guildId ?? null,
      channelCount: this.config?.channels.length ?? 0,
    };
  }

  async applyConfig(raw: unknown): Promise<{ applied: boolean; reconnected?: boolean }> {
    const run = this.applyMutex.then(() => this.applyConfigInner(raw));
    this.applyMutex = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async applyConfigInner(
    raw: unknown,
  ): Promise<{ applied: boolean; reconnected?: boolean; gatewayStatus?: GatewayStatus }> {
    const parsed = discordConfigApplySchema.parse(raw);
    if (parsed.botToken) {
      parsed.botToken = parsed.botToken.trim();
      const fp = discordConnectionFingerprint(parsed);
      if (this.lastAppliedTokenFingerprint && fp !== this.lastAppliedTokenFingerprint) {
        invalidateTokenVerifyCache();
      }
      this.lastAppliedTokenFingerprint = fp;
    }
    this.config = parsed;
    this.channelListCache = null;

    if (!parsed.enabled) {
      await this.shutdownClient();
      this.connectionFingerprint = null;
      this.gatewayStatus = "offline";
      this.lastGatewayError = null;
      return { applied: true, reconnected: false, gatewayStatus: "offline" };
    }

    const ready = Boolean(this.client?.isReady());
    if (!needsDiscordReconnect(this.connectionFingerprint, parsed, ready)) {
      return { applied: true, reconnected: false, gatewayStatus: this.gatewayStatus };
    }

    this.scheduleReconnect(parsed);
    return { applied: true, reconnected: true, gatewayStatus: "connecting" };
  }

  private scheduleReconnect(_parsed: DiscordRuntimeConfig): void {
    this.gatewayStatus = "connecting";
    this.lastGatewayError = null;
    const run = () => {
      const cfg = this.config;
      if (!cfg?.enabled || !cfg.botToken) return Promise.resolve();
      return this.runReconnect(cfg);
    };
    this.reconnectTask = (this.reconnectTask ?? Promise.resolve()).then(run).finally(() => {
      this.reconnectTask = null;
    });
  }

  private async runReconnect(parsed: DiscordRuntimeConfig): Promise<void> {
    try {
      await this.ensureClient(parsed.botToken!, parsed);
      this.connectionFingerprint = discordConnectionFingerprint(parsed);
      this.gatewayStatus = this.client?.isReady() ? "online" : "connecting";
      this.lastGatewayError = null;
    } catch (err) {
      if (err instanceof DiscordRateLimitError) {
        this.gatewayStatus = "connecting";
        this.lastGatewayError = err.message;
        console.warn("[discord] Rate limited:", err.message);
        this.scheduleRateLimitRetry(err.retryAfterSec);
        return;
      }
      this.gatewayStatus = "error";
      this.lastGatewayError = err instanceof Error ? err.message : String(err);
      console.error("[discord] Gateway connect failed:", this.lastGatewayError);
    }
  }

  private scheduleRateLimitRetry(retryAfterSec: number): void {
    if (this.rateLimitRetryTimer) return;
    const ms = (retryAfterSec + 2) * 1000;
    console.log(`[discord] Will retry gateway connect in ${retryAfterSec}s`);
    this.rateLimitRetryTimer = setTimeout(() => {
      this.rateLimitRetryTimer = null;
      const cfg = this.config;
      if (cfg?.enabled && cfg.botToken) {
        this.scheduleReconnect(cfg);
      }
    }, ms);
  }

  private async ensureClient(token: string, cfg: DiscordRuntimeConfig): Promise<void> {
    await this.shutdownClient();

    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ];
    if (!cfg.mentionsOnlyMode) {
      intents.push(GatewayIntentBits.MessageContent);
    }

    const client = new Client({
      intents,
      partials: [Partials.Channel],
    });

    let readyLogged = false;
    client.once(Events.ClientReady, (c) => {
      if (!readyLogged) {
        readyLogged = true;
        console.log(`[discord] Logged in as ${c.user.tag}`);
      }
      this.voice.setBotUserId(c.user.id);
    });

    client.on(Events.MessageCreate, (msg) => void this.onMessage(msg));

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      const cfg = this.config;
      if (!cfg?.enabled || !cfg.autoJoinVoice) return;
      if (newState.member?.user.bot) return;
      if (!newState.channelId || oldState.channelId === newState.channelId) return;

      const policy = cfg.channels.find((c) => c.channelId === newState.channelId);
      if (!policy?.voiceEnabled) return;

      const channel = newState.channel;
      if (!channel || !channel.isVoiceBased()) return;
      void this.voice
        .join(newState.guild, channel as VoiceBasedChannel, (payload) => {
          if (cfg.voiceBargeInEnabled === false) return;
          void this.controller.postVoiceInterrupt(payload);
        })
        .catch((err) => {
        console.warn("[discord] auto join voice failed", err);
      });
    });

    this.client = client;
    await loginDiscordClient(client, token);
    this.gatewayStatus = "online";
  }

  private async shutdownClient(): Promise<void> {
    this.voice.destroyAll();
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    await destroyDiscordClient(c);
    this.gatewayStatus = "offline";
  }

  private channelAllowed(channelId: string): boolean {
    const cfg = this.config;
    if (!cfg?.enabled) return false;
    if (!cfg.channels.length) return true;
    const policy = cfg.channels.find((c) => c.channelId === channelId);
    return policy ? policy.enabled && policy.textEnabled : false;
  }

  private async onMessage(msg: Message): Promise<void> {
    if (msg.author.bot || !msg.guildId || !msg.inGuild()) return;
    if (!this.channelAllowed(msg.channelId)) return;

    const cfg = this.config;
    if (cfg?.guildId && msg.guildId !== cfg.guildId) return;

    const mentionedBot = Boolean(this.client?.user && msg.mentions.users.has(this.client.user.id));
    const referencedBotMessage = Boolean(
      msg.reference?.messageId &&
        msg.channel.messages.cache.get(msg.reference.messageId)?.author.id === this.client?.user?.id,
    );

    await this.controller.postInbound([
      {
        messageId: msg.id,
        guildId: msg.guildId,
        channelId: msg.channelId,
        userId: msg.author.id,
        displayName: msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
        content: msg.content,
        mentionedBot,
        referencedBotMessage,
        createdAt: msg.createdAt.toISOString(),
      },
    ]);
  }

  async listChannels(): Promise<DiscordChannelsList> {
    return this.runGuildOp(() => this.listChannelsInner());
  }

  /** Guild REST work; use via listChannels() or from inside runGuildOp (never listChannels() nested). */
  private async listChannelsInner(): Promise<DiscordChannelsList> {
    const cached = this.channelListCache;
    if (cached && Date.now() - cached.at < 60_000) {
      return cached.data;
    }

    const client = this.client;
    const cfg = this.config;
    if (!client?.isReady()) throw new Error("Discord client not ready");
    const guildId = cfg?.guildId?.trim();
    if (!guildId) throw new Error("Guild ID is not configured in Discord settings");

    const guild = await withAbortRetry(() => client.guilds.fetch(guildId));
    await withAbortRetry(() => guild.channels.fetch());
    const policies = new Map(cfg?.channels.map((c) => [c.channelId, c]) ?? []);
    const restrict = (cfg?.channels.length ?? 0) > 0;

    const channels: DiscordChannelsList["channels"] = [];
    for (const ch of guild.channels.cache.values()) {
      if (!ch) continue;
      const policy = policies.get(ch.id);
      if (restrict && !policy) continue;

      const voice = ch.isVoiceBased();
      const text = ch.isTextBased() && !ch.isDMBased();
      if (!voice && !text) continue;

      channels.push({
        channelId: ch.id,
        name: "name" in ch && ch.name ? ch.name : ch.id,
        kind: voice ? "voice" : "text",
        textEnabled: policy?.textEnabled ?? !restrict,
        voiceEnabled: policy?.voiceEnabled ?? false,
      });
    }

    channels.sort((a, b) => a.name.localeCompare(b.name));
    const data = discordChannelsListSchema.parse({
      guildId: guild.id,
      guildName: guild.name,
      channels,
    });
    this.channelListCache = { at: Date.now(), data };
    return data;
  }

  private async resolveVoiceChannelIds(input: {
    channelId?: string;
    channelName?: string;
    guildId?: string;
  }): Promise<{ guildId: string; channelId: string }> {
    const guildId = resolveGuildId(this.config, input.guildId);
    if (input.channelId?.trim() && !input.channelName?.trim()) {
      return { guildId, channelId: input.channelId.trim() };
    }
    const list = await this.listChannelsInner();
    if (list.guildId !== guildId) {
      throw new Error(`Guild mismatch: expected ${list.guildId}, got ${guildId}`);
    }
    const picked = pickVoiceChannel(list.channels, input);
    return { guildId, channelId: picked.channelId };
  }

  async sendMessage(params: unknown): Promise<{ messageId: string }> {
    const body = discordMessageSendSchema.parse(params);
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");
    const channel = await client.channels.fetch(body.channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error("Channel not found or not text");
    }
    const sent = body.replyToMessageId
      ? await channel.send({
          content: body.content,
          reply: { messageReference: body.replyToMessageId },
        })
      : await channel.send({ content: body.content });
    return { messageId: sent.id };
  }

  async joinVoice(params: unknown): Promise<{
    joined: boolean;
    guildId: string;
    channelId: string;
    channelName?: string;
    status?: "connecting";
  }> {
    return this.runGuildOp(async () => {
      const raw = discordVoiceJoinRefSchema.parse(params);
      const { guildId, channelId } = await withAbortRetry(() => this.resolveVoiceChannelIds(raw));
      const client = this.client;
      if (!client?.isReady()) throw new Error("Discord client not ready");
      const guild = await withAbortRetry(() => client.guilds.fetch(guildId));
      const channel = await withAbortRetry(() => guild.channels.fetch(channelId));
      if (!channel || !channel.isVoiceBased()) throw new Error("Voice channel not found");
      const channelName = "name" in channel && channel.name ? channel.name : undefined;

      void this.voice
        .join(guild, channel, (payload) => {
          if (this.config?.voiceBargeInEnabled === false) return;
          void this.controller.postVoiceInterrupt(payload);
        })
        .catch((err) => {
          console.error("[discord] voice join failed:", err);
        });

      return { joined: true, guildId, channelId, channelName, status: "connecting" };
    });
  }

  async leaveVoice(params: unknown): Promise<{ left: boolean; guildId: string; channelId?: string }> {
    const raw = discordVoiceLeaveRefSchema.parse(params ?? {});
    const guildId = resolveGuildId(this.config, raw.guildId);
    if (raw.channelId?.trim() || raw.channelName?.trim()) {
      const { channelId } = await this.runGuildOp(() =>
        this.resolveVoiceChannelIds({
          channelId: raw.channelId,
          channelName: raw.channelName,
          guildId,
        }),
      );
      this.voice.leave(guildId, channelId);
      return { left: true, guildId, channelId };
    }
    this.voice.leaveGuild(guildId);
    return { left: true, guildId };
  }

  voiceStatus() {
    return { sessions: "see guild voice state" };
  }

  async speak(params: unknown): Promise<{ ok: boolean }> {
    const body = discordVoiceSpeakSchema.parse(params);
    await this.voice.speak(body.guildId, body.channelId, body.text, body.audioBase64);
    return { ok: true };
  }

  async cancelSpeak(params: { guildId: string; channelId: string }): Promise<{ ok: boolean }> {
    this.voice.cancelSpeak(params.guildId, params.channelId);
    return { ok: true };
  }
}

export const capabilityList = [
  {
    id: DISCORD_CAPABILITIES.HEALTH_GET,
    name: "Discord health",
    description: "Connection status for the Discord bot",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.CONFIG_APPLY,
    name: "Apply Discord config",
    description: "Login token, guild, channel policies",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.CONFIG_STATUS,
    name: "Discord config status",
    description: "Runtime status without secrets",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.CHANNELS_LIST,
    name: "List Discord channels",
    description: "Resolved channel names and ids for the configured guild",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.MESSAGE_SEND,
    name: "Send Discord message",
    description: "Post a message to a configured text channel",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordMessageSendToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_JOIN,
    name: "Join voice channel",
    description:
      "Connect the bot to a Discord voice channel. Pass channelName or channelId; guildId is optional when configured in Discord settings.",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordVoiceChannelToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_LEAVE,
    name: "Leave voice channel",
    description:
      "Disconnect the bot from voice. Pass channelName or channelId to leave a specific channel, or omit both to leave the guild voice connection.",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordVoiceLeaveToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_STATUS,
    name: "Voice status",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_SPEAK,
    name: "Speak in voice",
    description: "Play TTS audio or simulated speech for barge-in",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: true,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL,
    name: "Cancel voice speech",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
] as const;
