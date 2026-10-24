import { ttsPlaybackChunkSchema } from "@echo/voice-contract";
import type { z } from "zod";

type PlaybackChunk = z.infer<typeof ttsPlaybackChunkSchema>;

export class ControllerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
    return h;
  }

  async postPlayback(chunk: PlaybackChunk): Promise<void> {
    const body = ttsPlaybackChunkSchema.parse(chunk);
    const res = await fetch(`${this.baseUrl}/api/v1/tts/playback`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`tts playback POST failed: ${res.status} ${err}`);
    }
  }
}
