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
  discordVoiceJoinSchema,
  discordVoiceSpeakSchema,
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

export type GatewayStatus = "offline" | "connecting" | "online" | "error";

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

  constructor(controllerBaseUrl: string, authToken?: string) {
    this.controller = new ControllerClient(controllerBaseUrl, authToken);
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

  async joinVoice(params: unknown): Promise<{ joined: boolean }> {
    const body = discordVoiceJoinSchema.parse(params);
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");
    const channel = await client.channels.fetch(body.channelId);
    if (!channel || !channel.isVoiceBased()) throw new Error("Voice channel not found");
    await this.voice.join(channel.guild, channel, (payload) => {
      if (this.config?.voiceBargeInEnabled === false) return;
      void this.controller.postVoiceInterrupt(payload);
    });
    return { joined: true };
  }

  async leaveVoice(params: unknown): Promise<{ left: boolean }> {
    const body = discordVoiceJoinSchema.parse(params);
    this.voice.leave(body.guildId, body.channelId);
    return { left: true };
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
    id: DISCORD_CAPABILITIES.MESSAGE_SEND,
    name: "Send Discord message",
    description: "Post a message to a configured text channel",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_JOIN,
    name: "Join voice channel",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_LEAVE,
    name: "Leave voice channel",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
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
