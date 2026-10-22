import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  getVoiceConnection,
  getVoiceConnections,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { Events, PermissionFlagsBits, type Guild, type VoiceBasedChannel } from "discord.js";

const READY_TIMEOUT_MS = 45_000;
const JOIN_ATTEMPTS = 3;

type SpeakSession = {
  guildId: string;
  channelId: string;
  player: AudioPlayer;
  simulatedTimer: ReturnType<typeof setTimeout> | null;
  speakingSimulated: boolean;
};

type InterruptHandler = (payload: {
  guildId: string;
  channelId: string;
  userId: string;
  displayName: string;
}) => void;

export class VoiceManager {
  private sessions = new Map<string, SpeakSession>();
  private botUserId: string | null = null;
  /** One join at a time per guild (tool join vs auto-join race). */
  private joinLocks = new Map<string, Promise<void>>();

  setBotUserId(id: string): void {
    this.botUserId = id;
  }

  private key(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  async join(
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: InterruptHandler,
  ): Promise<void> {
    const guildId = guild.id;
    const prior = this.joinLocks.get(guildId) ?? Promise.resolve();
    const job = prior.catch(() => undefined).then(() => this.joinInner(guild, channel, onInterrupt));
    this.joinLocks.set(guildId, job);
    try {
      await job;
    } finally {
      if (this.joinLocks.get(guildId) === job) {
        this.joinLocks.delete(guildId);
      }
    }
  }

  private async joinInner(
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: InterruptHandler,
  ): Promise<void> {
    await assertCanJoinVoice(guild, channel);

    const sessionKey = this.key(guild.id, channel.id);
    const existingConn = getVoiceConnection(guild.id);

    if (this.sessions.has(sessionKey) && existingConn?.joinConfig.channelId === channel.id) {
      try {
        await waitUntilVoiceReady(existingConn, guild, 10_000);
        return;
      } catch {
        this.leave(guild.id, channel.id);
      }
    }

    if (existingConn) {
      const sameChannel = existingConn.joinConfig.channelId === channel.id;
      if (sameChannel) {
        try {
          await waitUntilVoiceReady(existingConn, guild, READY_TIMEOUT_MS);
          this.attachSession(existingConn, guild, channel, onInterrupt);
          return;
        } catch (err) {
          this.logConnectionFailure(existingConn, err);
          try {
            existingConn.destroy();
          } catch {
            /* ignore */
          }
        }
      } else {
        existingConn.destroy();
      }
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= JOIN_ATTEMPTS; attempt++) {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as never,
        selfDeaf: false,
        selfMute: false,
      });
      this.watchStateChanges(connection, attempt);

      try {
        await waitUntilVoiceReady(connection, guild, READY_TIMEOUT_MS);
        this.attachSession(connection, guild, channel, onInterrupt);
        return;
      } catch (err) {
        lastErr = err;
        this.logConnectionFailure(connection, err, attempt);
        try {
          connection.destroy();
        } catch {
          /* ignore */
        }
        if (attempt < JOIN_ATTEMPTS) {
          await delay(750 * attempt);
        }
      }
    }
    throw lastErr;
  }

  private attachSession(
    connection: VoiceConnection,
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: InterruptHandler,
  ): void {
    const sessionKey = this.key(guild.id, channel.id);
    if (this.sessions.has(sessionKey)) {
      return;
    }

    const player = createAudioPlayer();
    connection.subscribe(player);

    connection.receiver.speaking.on("start", (userId) => {
      const member = guild.members.cache.get(userId);
      const user = member?.user;
      if (!user || user.bot) return;
      this.handleUserSpeaking(
        guild.id,
        channel.id,
        user.id,
        member?.displayName ?? user.displayName ?? user.username,
        onInterrupt,
      );
    });

    this.sessions.set(sessionKey, {
      guildId: guild.id,
      channelId: channel.id,
      player,
      simulatedTimer: null,
      speakingSimulated: false,
    });
  }

  private watchStateChanges(connection: VoiceConnection, attempt: number): void {
    if (!process.env.DISCORD_VOICE_DEBUG) return;
    connection.on("stateChange", (oldState, newState) => {
      console.log(
        `[discord/voice] attempt ${attempt}: ${oldState.status} -> ${newState.status}`,
      );
    });
  }

  private logConnectionFailure(connection: VoiceConnection, err: unknown, attempt?: number): void {
    const prefix =
      attempt !== undefined
        ? `[discord/voice] join attempt ${attempt}/${JOIN_ATTEMPTS} failed`
        : "[discord/voice] join failed";
    const status = connection.state.status;
    console.warn(`${prefix} (state=${status}):`, err);
  }

  /** Tear down all @discordjs/voice sessions (required before discord.js Client.destroy). */
  destroyAll(): void {
    for (const session of this.sessions.values()) {
      if (session.simulatedTimer) clearTimeout(session.simulatedTimer);
      try {
        session.player.stop();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
    const voiceMap = getVoiceConnections();
    for (const conn of voiceMap.values()) {
      try {
        conn.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  leave(guildId: string, channelId: string): void {
    const k = this.key(guildId, channelId);
    const session = this.sessions.get(k);
    if (session?.simulatedTimer) clearTimeout(session.simulatedTimer);
    this.sessions.delete(k);
    getVoiceConnection(guildId)?.destroy();
  }

  /** Disconnect from voice in a guild (when channel id is unknown). */
  leaveGuild(guildId: string): void {
    for (const [k, session] of this.sessions) {
      if (!k.startsWith(`${guildId}:`)) continue;
      if (session.simulatedTimer) clearTimeout(session.simulatedTimer);
      this.sessions.delete(k);
    }
    getVoiceConnection(guildId)?.destroy();
  }

  cancelSpeak(guildId: string, channelId: string): void {
    const session = this.sessions.get(this.key(guildId, channelId));
    if (!session) return;
    if (session.simulatedTimer) clearTimeout(session.simulatedTimer);
    session.simulatedTimer = null;
    session.speakingSimulated = false;
    session.player.stop();
  }

  /**
   * Play TTS audio when provided; otherwise simulate speech duration for barge-in testing
   * until a TTS module supplies `audioBase64`.
   */
  async speak(
    guildId: string,
    channelId: string,
    text: string,
    audioBase64?: string,
  ): Promise<void> {
    const session = this.sessions.get(this.key(guildId, channelId));
    if (!session) throw new Error("Not in voice channel");

    this.cancelSpeak(guildId, channelId);

    if (audioBase64) {
      // Future: decode opus/pcm and play via createAudioResource
      console.warn("[discord/voice] audioBase64 provided but decoder not wired yet; using duration simulation");
    }

    session.speakingSimulated = true;
    const durationMs = Math.min(60_000, Math.max(1500, text.length * 45));
    session.simulatedTimer = setTimeout(() => {
      session.speakingSimulated = false;
      session.simulatedTimer = null;
    }, durationMs);
  }

  isSpeaking(guildId: string, channelId: string): boolean {
    const session = this.sessions.get(this.key(guildId, channelId));
    if (!session) return false;
    if (session.speakingSimulated) return true;
    return session.player.state.status === AudioPlayerStatus.Playing;
  }

  /** Discord speaking map — interrupt if a human talks while bot output is active. */
  handleUserSpeaking(
    guildId: string,
    channelId: string,
    userId: string,
    displayName: string,
    onInterrupt: InterruptHandler,
  ): void {
    if (this.botUserId && userId === this.botUserId) return;
    if (!this.isSpeaking(guildId, channelId)) return;
    this.cancelSpeak(guildId, channelId);
    onInterrupt({ guildId, channelId, userId, displayName });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @discordjs/voice 0.18–0.19: server packet can arrive before state; configureNetworking is never retried. */
type VoiceConnectionWithNetworking = VoiceConnection & { configureNetworking(): void };

function nudgeVoiceNetworking(connection: VoiceConnection): void {
  if (connection.state.status !== VoiceConnectionStatus.Signalling) return;
  (connection as VoiceConnectionWithNetworking).configureNetworking();
}

async function waitUntilVoiceReady(
  connection: VoiceConnection,
  guild: Guild,
  timeoutMs: number,
): Promise<void> {
  const client = guild.client;
  const onVoiceState = (_old: unknown, member: { id: string; guild: { id: string } }) => {
    if (member.id !== client.user?.id) return;
    if (member.guild.id !== guild.id) return;
    nudgeVoiceNetworking(connection);
  };

  client.on(Events.VoiceStateUpdate, onVoiceState);
  const tick = setInterval(() => nudgeVoiceNetworking(connection), 400);
  try {
    nudgeVoiceNetworking(connection);
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
  } finally {
    clearInterval(tick);
    client.off(Events.VoiceStateUpdate, onVoiceState);
  }
}

async function assertCanJoinVoice(guild: Guild, channel: VoiceBasedChannel): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    throw new Error("Bot lacks Connect permission in that voice channel");
  }
  const limit = channel.userLimit ?? 0;
  if (
    limit > 0 &&
    channel.members.size >= limit &&
    !perms.has(PermissionFlagsBits.MoveMembers)
  ) {
    throw new Error("Voice channel is full (need Move Members to bypass)");
  }
}
