import { Readable } from "node:stream";
import {
  createAudioResource,
  entersState,
  StreamType,
  type AudioPlayer,
  AudioPlayerStatus,
} from "@discordjs/voice";

function streamTypeForMime(mimeType: string | undefined): StreamType {
  const m = (mimeType ?? "audio/wav").toLowerCase();
  if (m.includes("ogg")) return StreamType.OggOpus;
  if (m.includes("webm")) return StreamType.WebmOpus;
  if (m.includes("opus") && !m.includes("ogg")) return StreamType.Opus;
  return StreamType.Arbitrary;
}

/**
 * Decode synthesized TTS (wav/mp3/ogg) and play on the guild voice connection.
 * Requires FFmpeg on PATH for non-opus containers (see prism-media / dependency report).
 */
export async function playAudioBufferOnPlayer(
  player: AudioPlayer,
  audioBase64: string,
  mimeType?: string,
): Promise<void> {
  const audio = Buffer.from(audioBase64, "base64");
  if (audio.length === 0) {
    throw new Error("Empty audio payload");
  }

  const stream = Readable.from(audio);
  const resource = createAudioResource(stream, {
    inputType: streamTypeForMime(mimeType),
  });

  player.play(resource);

  try {
    await entersState(player, AudioPlayerStatus.Playing, 10_000);
  } catch {
    // Very short clips may skip Playing; still wait for Idle.
  }
  await entersState(player, AudioPlayerStatus.Idle, 180_000);
}
