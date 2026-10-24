import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  getVoiceConnection,
  getVoiceConnections,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { ensureVoiceCryptoDeps } from "./voice-deps.js";
import { playAudioBufferOnPlayer } from "./voice-audio-playback.js";
import type { Guild, VoiceBasedChannel } from "discord.js";
import type { VoiceConnection } from "@discordjs/voice";
import type { VoiceSttBridge } from "./voice-stt-bridge.js";
import type { VoiceOccupancy } from "./voice-occupancy.js";

type SpeakSession = {
  guildId: string;
  channelId: string;
  player: AudioPlayer;
  simulatedTimer: ReturnType<typeof setTimeout> | null;
  speakingSimulated: boolean;
};

export class VoiceManager {
  private sessions = new Map<string, SpeakSession>();
  private botUserId: string | null = null;

  constructor(private readonly occupancy: VoiceOccupancy) {}

  setBotUserId(id: string): void {
    this.botUserId = id;
  }

  private key(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  async join(
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: (payload: {
      guildId: string;
      channelId: string;
      userId: string;
      displayName: string;
    }) => void,
    sttBridge?: VoiceSttBridge,
  ): Promise<void> {
    await ensureVoiceCryptoDeps();
    const READY_TIMEOUT_MS = 60_000;
    const existing = getVoiceConnection(guild.id);
    if (existing?.joinConfig.channelId === channel.id) {
      if (existing.state.status === VoiceConnectionStatus.Ready) {
        console.log(`[discord] voice.join already Ready in #${channel.name}`);
        this.attachSpeakSession(existing, guild, channel, onInterrupt, sttBridge);
        return;
      }
      console.log(
        `[discord] voice.join reusing connection (state=${existing.state.status}) → #${channel.name}`,
      );
      try {
        await entersState(existing, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
        this.attachSpeakSession(existing, guild, channel, onInterrupt, sttBridge);
        return;
      } catch {
        console.warn("[discord] voice.join stale connection; creating a new one");
        existing.destroy();
      }
    } else if (existing) {
      console.log("[discord] voice.join leaving previous voice connection in this guild");
      existing.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator as never,
      selfDeaf: false,
      selfMute: false,
    });
    connection.on("stateChange", (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        const reason = (newState as { reason?: unknown }).reason;
        console.warn(
          `[discord] voice connection destroyed (#${channel.name}) from ${oldState.status}` +
            (reason != null ? ` reason=${String(reason)}` : ""),
        );
        return;
      }
      console.log(`[discord] voice connection state → ${newState.status} (#${channel.name})`);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
    } catch (err) {
      const last = connection.state.status;
      try {
        connection.destroy();
      } catch {
        /* ignore */
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Voice connection did not reach Ready within ${READY_TIMEOUT_MS / 1000}s (last state: ${last}). ` +
          "Check bot Connect/Speak permissions, Windows firewall UDP, and voice libs (libsodium + opus). " +
          `Detail: ${detail}`,
      );
    }
    const player = createAudioPlayer();
    connection.subscribe(player);
    this.attachSpeakSession(connection, guild, channel, onInterrupt, sttBridge, player);
  }

  /** Register player + STT/speaking hooks for a live connection (idempotent per channel). */
  private attachSpeakSession(
    connection: VoiceConnection,
    guild: Guild,
    channel: VoiceBasedChannel,
    onInterrupt: (payload: {
      guildId: string;
      channelId: string;
      userId: string;
      displayName: string;
    }) => void,
    sttBridge?: VoiceSttBridge,
    existingPlayer?: AudioPlayer,
  ): void {
    const k = this.key(guild.id, channel.id);
    if (this.sessions.has(k)) return;

    const player = existingPlayer ?? createAudioPlayer();
    if (!existingPlayer) {
      connection.subscribe(player);
    }

    player.on("error", (err: Error) => {
      console.error("[discord/voice] AudioPlayer error:", err.message);
    });

    connection.receiver.speaking.on("start", (userId) => {
      const member = guild.members.cache.get(userId);
      const user = member?.user;
      if (!user || user.bot) return;
      this.occupancy.userStarted(guild.id, channel.id, user.id);
      this.handleUserSpeaking(
        guild.id,
        channel.id,
        user.id,
        member?.displayName ?? user.displayName ?? user.username,
        onInterrupt,
      );
    });

    connection.receiver.speaking.on("end", (userId) => {
      if (this.botUserId && userId === this.botUserId) return;
      this.occupancy.userEnded(guild.id, channel.id, userId);
    });

    sttBridge?.attachConnection(
      connection,
      guild.id,
      channel.id,
      (userId) => {
        const member = guild.members.cache.get(userId);
        const user = member?.user;
        return member?.displayName ?? user?.displayName ?? user?.username ?? userId;
      },
      (userId) => Boolean(this.botUserId && userId === this.botUserId),
    );

    this.sessions.set(k, {
      guildId: guild.id,
      channelId: channel.id,
      player,
      simulatedTimer: null,
      speakingSimulated: false,
    });
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
  async awaitSilence(
    guildId: string,
    channelId: string,
    opts?: { minSilentMs?: number; maxWaitMs?: number },
  ): Promise<{ ok: boolean; timedOut?: boolean }> {
    return this.occupancy.waitUntilSilent(guildId, channelId, opts);
  }

  async speak(
    guildId: string,
    channelId: string,
    text: string,
    audioBase64?: string,
    mimeType?: string,
  ): Promise<void> {
    const session = this.sessions.get(this.key(guildId, channelId));
    if (!session) throw new Error("Not in voice channel");

    const gate = await this.occupancy.waitUntilSilent(guildId, channelId, {
      minSilentMs: 700,
      maxWaitMs: 180_000,
    });
    if (!gate.ok) {
      console.warn(
        "[discord/voice] Skipping TTS — channel still occupied after wait (humans still speaking)",
      );
      return;
    }

    this.cancelSpeak(guildId, channelId);

    if (audioBase64?.trim()) {
      try {
        await playAudioBufferOnPlayer(session.player, audioBase64, mimeType);
        console.log(
          `[discord/voice] played TTS (${mimeType ?? "audio/wav"}, ${text.slice(0, 40)}${text.length > 40 ? "…" : ""})`,
        );
        return;
      } catch (err) {
        console.error(
          "[discord/voice] TTS playback failed:",
          err instanceof Error ? err.message : err,
        );
        throw err instanceof Error ? err : new Error(String(err));
      }
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
    onInterrupt: (payload: {
      guildId: string;
      channelId: string;
      userId: string;
      displayName: string;
    }) => void,
  ): void {
    if (this.botUserId && userId === this.botUserId) return;
    if (!this.isSpeaking(guildId, channelId)) return;
    this.cancelSpeak(guildId, channelId);
    onInterrupt({ guildId, channelId, userId, displayName });
  }
}
