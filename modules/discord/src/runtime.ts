import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
  type VoiceBasedChannel,
} from "discord.js";
import {
  DISCORD_CAPABILITIES,
  discordConfigApplySchema,
  discordEmojiListSchema,
  discordMemberResolveSchema,
  discordMessageReactSchema,
  discordMessageReactionsGetSchema,
  discordMessageSendSchema,
  discordVoiceAwaitSilenceSchema,
  discordVoiceJoinParamsSchema,
  discordVoiceSpeakParamsSchema,
  type DiscordRuntimeConfig,
} from "@echo/discord-contract";
import {
  discordEmojiListToolSchema,
  discordMemberResolveToolSchema,
  discordMessageReactToolSchema,
  discordMessageReactionsGetToolSchema,
  discordMessageSendToolSchema,
  discordVoiceJoinToolSchema,
  discordVoiceLeaveToolSchema,
  discordVoiceSpeakToolSchema,
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
import { VoiceSttBridge } from "./voice-stt-bridge.js";
import { VoiceOccupancy } from "./voice-occupancy.js";

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
  private readonly voiceOccupancy = new VoiceOccupancy();
  private readonly voice = new VoiceManager(this.voiceOccupancy);
  private readonly controller: ControllerClient;
  private readonly sttBridge: VoiceSttBridge;

  constructor(controllerBaseUrl: string, authToken?: string) {
    this.controller = new ControllerClient(controllerBaseUrl, authToken);
    this.sttBridge = new VoiceSttBridge(this.controller.createSttBridgeClient(), this.voiceOccupancy);
  }

  private async joinVoiceChannel(
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: (payload: {
      guildId: string;
      channelId: string;
      userId: string;
      displayName: string;
    }) => void,
  ): Promise<void> {
    await this.controller.refreshSttAvailability();
    await this.voice.join(guild, channel, onInterrupt, this.sttBridge);
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
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.GuildVoiceStates,
    ];
    if (!cfg.mentionsOnlyMode) {
      intents.push(GatewayIntentBits.MessageContent);
    }
    if (cfg.serverMembersIntent) {
      intents.push(GatewayIntentBits.GuildMembers);
    }

    const client = new Client({
      intents,
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
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
    client.on(Events.MessageReactionAdd, (reaction, user) => void this.onReactionAdd(reaction, user));

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      const cfg = this.config;
      if (!cfg?.enabled || !cfg.autoJoinVoice) return;
      if (newState.member?.user.bot) return;
      if (!newState.channelId || oldState.channelId === newState.channelId) return;

      const policy = cfg.channels.find((c) => c.channelId === newState.channelId);
      if (!policy?.voiceEnabled) return;

      const channel = newState.channel;
      if (!channel || !channel.isVoiceBased()) return;
      void this.joinVoiceChannel(newState.guild, channel as VoiceBasedChannel, (payload) => {
        if (cfg.voiceBargeInEnabled === false) return;
        void this.controller.postVoiceInterrupt(payload);
      }).catch((err) => {
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
    let referencedBotMessage = false;
    let replyTo: {
      messageId: string;
      authorUserId: string;
      authorDisplayName: string;
      content: string;
    } | undefined;

    if (msg.reference?.messageId) {
      const ref = await msg.fetchReference().catch(() => null);
      if (ref) {
        referencedBotMessage = ref.author.id === this.client?.user?.id;
        const refContent =
          ref.content.trim() ||
          (ref.attachments.size > 0 ? `[${ref.attachments.size} attachment(s)]` : "[no text content]");
        replyTo = {
          messageId: ref.id,
          authorUserId: ref.author.id,
          authorDisplayName:
            ref.member?.displayName ?? ref.author.displayName ?? ref.author.username,
          content: refContent.slice(0, 1500),
        };
      }
    }

    const mentionedUsers = [...msg.mentions.users.values()]
      .filter((u) => !u.bot)
      .map((u) => ({
        userId: u.id,
        username: u.username,
        displayName: msg.guild?.members.cache.get(u.id)?.displayName ?? u.displayName ?? undefined,
      }));

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
        replyTo,
        mentionedUsers: mentionedUsers.length > 0 ? mentionedUsers : undefined,
        createdAt: msg.createdAt.toISOString(),
      },
    ]);
  }

  private async onReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return;
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    const message = reaction.message;
    if (message.partial) {
      try {
        await message.fetch();
      } catch {
        return;
      }
    }
    if (!message.guildId || !message.inGuild()) return;
    if (!this.channelAllowed(message.channelId)) return;
    const cfg = this.config;
    if (cfg?.guildId && message.guildId !== cfg.guildId) return;

    const emojiLabel = reaction.emoji.id
      ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
      : (reaction.emoji.name ?? "?");

    const reactorName =
      message.guild?.members.cache.get(user.id)?.displayName ??
      ("username" in user && user.username ? user.username : "Someone");

    const authorName =
      message.member?.displayName ??
      message.author.displayName ??
      message.author.username;
    const snippet =
      message.content.trim().slice(0, 120) ||
      (message.attachments.size > 0 ? `[${message.attachments.size} attachment(s)]` : "[no text]");

    await this.controller.postActivity({
      guildId: message.guildId,
      channelId: message.channelId,
      text: `${reactorName} reacted ${emojiLabel} to ${authorName}: "${snippet}"`,
    });
  }

  private resolveGuildId(explicit?: string): string {
    const guildId = explicit?.trim() || this.config?.guildId?.trim();
    if (!guildId) throw new Error("guildId is required (configure guild or pass guildId)");
    return guildId;
  }

  private async fetchGuild(guildId: string): Promise<Guild> {
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");
    return client.guilds.fetch(guildId);
  }

  private resolveReactEmoji(guild: Guild, emoji: string): string {
    const trimmed = emoji.trim();
    const mentionMatch = trimmed.match(/^<a?:([\w~]+):(\d+)>$/);
    if (mentionMatch) return mentionMatch[2]!;
    if (/^\d+$/.test(trimmed) && guild.emojis.cache.has(trimmed)) return trimmed;
    const bareName = trimmed.replace(/^:+|:+$/g, "");
    const byName = guild.emojis.cache.find(
      (e) => e.name?.toLowerCase() === bareName.toLowerCase(),
    );
    if (byName) return byName.id;
    return trimmed;
  }

  async listEmojis(params: unknown): Promise<{
    emojis: { id: string; name: string; animated: boolean; mention: string }[];
  }> {
    const body = discordEmojiListSchema.parse(params);
    const guild = await this.fetchGuild(this.resolveGuildId(body.guildId));
    await guild.emojis.fetch();
    const emojis = [...guild.emojis.cache.values()].map((e) => ({
      id: e.id,
      name: e.name ?? "emoji",
      animated: e.animated ?? false,
      mention: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
    }));
    return { emojis };
  }

  async resolveMembers(params: unknown): Promise<{
    matches: { userId: string; username: string; displayName: string; mention: string }[];
  }> {
    const body = discordMemberResolveSchema.parse(params);
    const guild = await this.fetchGuild(this.resolveGuildId(body.guildId));
    const matches: { userId: string; username: string; displayName: string; mention: string }[] =
      [];

    const pushMember = (m: import("discord.js").GuildMember) => {
      if (matches.some((x) => x.userId === m.id)) return;
      matches.push({
        userId: m.id,
        username: m.user.username,
        displayName: m.displayName,
        mention: `<@${m.id}>`,
      });
    };

    if (body.userId) {
      const m = await guild.members.fetch(body.userId).catch(() => null);
      if (m) pushMember(m);
      return { matches };
    }

    const q = body.query!.toLowerCase();
    for (const m of guild.members.cache.values()) {
      if (matches.length >= 5) break;
      const un = m.user.username.toLowerCase();
      const dn = m.displayName.toLowerCase();
      const gn = m.user.globalName?.toLowerCase() ?? "";
      if (un === q || dn === q || gn === q || un.includes(q) || dn.includes(q)) {
        pushMember(m);
      }
    }

    if (matches.length === 0) {
      try {
        const searched = await guild.members.search({ query: body.query!, limit: 5 });
        for (const m of searched.values()) {
          pushMember(m);
        }
      } catch {
        // Guild Members intent / search unavailable
      }
    }

    return { matches: matches.slice(0, 5) };
  }

  private normalizeVoiceJoinParams(params: unknown): unknown {
    if (typeof params !== "object" || params === null) return params;
    const base = { ...(params as Record<string, unknown>) };
    if (typeof base.input === "string" && !base.query && !base.channelId) {
      base.query = base.input;
      delete base.input;
    }
    return base;
  }

  private async resolveVoiceChannel(
    guildId: string,
    channelId?: string,
    query?: string,
  ): Promise<VoiceBasedChannel> {
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");

    if (channelId?.trim()) {
      const channel = await client.channels.fetch(channelId.trim());
      if (!channel?.isVoiceBased()) throw new Error("Voice channel not found");
      return channel;
    }

    const q = query!.trim().toLowerCase();
    const guild = await this.fetchGuild(guildId);
    await guild.channels.fetch().catch(() => undefined);

    const voiceChannels = guild.channels.cache.filter((ch) => ch.isVoiceBased());
    let partial: VoiceBasedChannel | undefined;
    for (const ch of voiceChannels.values()) {
      if (!ch.isVoiceBased()) continue;
      const name = ch.name.toLowerCase();
      if (name === q) return ch;
      if (!partial && name.includes(q)) partial = ch;
    }
    if (partial) return partial;
    throw new Error(`No voice channel matching "${query}" in guild ${guild.name}`);
  }

  private async resolveVoiceJoinTarget(params: unknown): Promise<{
    guildId: string;
    channelId: string;
    channel: VoiceBasedChannel;
  }> {
    const body = discordVoiceJoinParamsSchema.parse(this.normalizeVoiceJoinParams(params));
    const guildId = this.resolveGuildId(body.guildId);
    const channel = await this.resolveVoiceChannel(guildId, body.channelId, body.query);
    return { guildId: channel.guild.id, channelId: channel.id, channel };
  }

  async reactToMessage(params: unknown): Promise<{ ok: true }> {
    const body = discordMessageReactSchema.parse(params);
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");
    const channel = await client.channels.fetch(body.channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error("Channel not found or not text");
    }
    const message = await channel.messages.fetch(body.messageId);
    const guild = message.guild;
    if (!guild) throw new Error("Message is not in a guild");
    const emoji = this.resolveReactEmoji(guild, body.emoji);
    await message.react(emoji);
    return { ok: true };
  }

  async getMessageReactions(params: unknown): Promise<{
    reactions: {
      emoji: string;
      count: number;
      sampleUsers: { userId: string; username: string }[];
    }[];
  }> {
    const body = discordMessageReactionsGetSchema.parse(params);
    const client = this.client;
    if (!client) throw new Error("Discord client not ready");
    const channel = await client.channels.fetch(body.channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error("Channel not found or not text");
    }
    const message = await channel.messages.fetch(body.messageId);
    const reactions: {
      emoji: string;
      count: number;
      sampleUsers: { userId: string; username: string }[];
    }[] = [];

    for (const reaction of message.reactions.cache.values()) {
      const emoji = reaction.emoji.id
        ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
        : (reaction.emoji.name ?? "?");
      let sampleUsers: { userId: string; username: string }[] = [];
      try {
        const users = await reaction.users.fetch({ limit: 5 });
        sampleUsers = [...users.values()].map((u) => ({
          userId: u.id,
          username: u.username,
        }));
      } catch {
        sampleUsers = [];
      }
      reactions.push({
        emoji,
        count: reaction.count ?? sampleUsers.length,
        sampleUsers,
      });
    }

    return { reactions };
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

  async joinVoice(params: unknown): Promise<{ joined: boolean; guildId: string; channelId: string }> {
    console.log("[discord] voice.join params:", JSON.stringify(this.normalizeVoiceJoinParams(params)));
    const { channel, guildId, channelId } = await this.resolveVoiceJoinTarget(params);
    console.log(`[discord] voice.join connecting → #${channel.name} (${channelId}) in ${channel.guild.name}`);
    await this.joinVoiceChannel(channel.guild, channel, (payload) => {
      if (this.config?.voiceBargeInEnabled === false) return;
      void this.controller.postVoiceInterrupt(payload);
    });
    console.log(`[discord] voice.join ready in #${channel.name}`);
    return { joined: true, guildId, channelId };
  }

  async leaveVoice(params: unknown): Promise<{ left: boolean }> {
    const { guildId, channelId } = await this.resolveVoiceJoinTarget(params);
    this.voice.leave(guildId, channelId);
    return { left: true };
  }

  voiceStatus() {
    return { sessions: "see guild voice state" };
  }

  async speak(params: unknown): Promise<{ ok: boolean }> {
    const raw = discordVoiceSpeakParamsSchema.parse(this.normalizeVoiceJoinParams(params));
    const guildId = this.resolveGuildId(raw.guildId);
    const channel = await this.resolveVoiceChannel(guildId, raw.channelId, raw.query);
    await this.voice.speak(
      channel.guild.id,
      channel.id,
      raw.text,
      raw.audioBase64,
      raw.mimeType,
    );
    return { ok: true };
  }

  async cancelSpeak(params: { guildId: string; channelId: string }): Promise<{ ok: boolean }> {
    this.voice.cancelSpeak(params.guildId, params.channelId);
    return { ok: true };
  }

  async awaitVoiceSilence(params: unknown): Promise<{ ok: boolean; timedOut?: boolean }> {
    const body = discordVoiceAwaitSilenceSchema.parse(params);
    return this.voice.awaitSilence(body.guildId, body.channelId, {
      minSilentMs: body.minSilentMs,
      maxWaitMs: body.maxWaitMs,
    });
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
    inputSchema: discordMessageSendToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.EMOJI_LIST,
    name: "List guild emojis",
    description: "List custom server emotes (use mention strings in messages or reactions)",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordEmojiListToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.MEMBER_RESOLVE,
    name: "Resolve guild member",
    description: "Find a member by username/display name for @mentions",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordMemberResolveToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.MESSAGE_REACT,
    name: "React to message",
    description:
      "Add an emoji reaction to a message in the active Discord channel (use [id:…] from chat lines; channelId optional)",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordMessageReactToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.MESSAGE_REACTIONS_GET,
    name: "Get message reactions",
    description: "List reactions on a Discord message",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordMessageReactionsGetToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_JOIN,
    name: "Join voice channel",
    description:
      "Join a voice channel by name (query) or channelId. Guild is filled from Discord chat context.",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: discordVoiceJoinToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_LEAVE,
    name: "Leave voice channel",
    description: "Leave a voice channel the bot joined (same query/channelId as join).",
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
    description: "Play TTS audio or simulated speech in a joined voice channel",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: true,
    inputSchema: discordVoiceSpeakToolSchema,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL,
    name: "Cancel voice speech",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: DISCORD_CAPABILITIES.VOICE_AWAIT_SILENCE,
    name: "Await voice channel silence",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
] as const;
