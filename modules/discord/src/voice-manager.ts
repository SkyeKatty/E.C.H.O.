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
import type { Guild, VoiceBasedChannel } from "discord.js";

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
  ): Promise<void> {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator as never,
      selfDeaf: false,
      selfMute: false,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
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

    this.sessions.set(this.key(guild.id, channel.id), {
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
