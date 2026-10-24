import type { z } from "zod";
import type { ttsPlaybackChunkSchema } from "@echo/voice-contract";
import type { DiscordModuleService } from "../discord/discord-module-service.js";
import type { EventLog } from "../persona/state.js";
import { parseDiscordVoiceSink } from "./speech-origin.js";

type PlaybackChunk = z.infer<typeof ttsPlaybackChunkSchema>;

export class TtsPlaybackRouter {
  constructor(
    private readonly discord: DiscordModuleService,
    private readonly eventLog: EventLog,
  ) {}

  async handlePlayback(chunk: PlaybackChunk): Promise<void> {
    const sink = chunk.sink ?? "default";

    if (sink === "twitch" || sink === "stt") {
      this.eventLog.append({
        type: "tts.playback",
        summary: `[${sink}] seq ${chunk.sequence} (${chunk.text.slice(0, 60)}…) — awaiting ${sink} module sink`,
      });
      return;
    }

    const voice = parseDiscordVoiceSink(sink);
    if (voice && this.discord.isAvailable()) {
      await this.discord.speakInVoice({
        guildId: voice.guildId,
        channelId: voice.channelId,
        text: chunk.text,
        audioBase64: chunk.audioBase64,
        mimeType: chunk.mimeType,
      });
      this.eventLog.append({
        type: "tts.playback",
        summary: `Discord voice seq ${chunk.sequence} (${chunk.text.slice(0, 48)}…)`,
      });
      return;
    }

    this.eventLog.append({
      type: "tts.playback",
      summary: `TTS chunk seq ${chunk.sequence} (no sink handler for ${sink})`,
    });
  }
}
