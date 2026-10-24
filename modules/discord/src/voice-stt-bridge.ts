import { EndBehaviorType, type VoiceConnection } from "@discordjs/voice";
import OpusScript from "opusscript";
import prism from "prism-media";
import type { VoiceOccupancy } from "./voice-occupancy.js";

export type SttBridgeClient = {
  isEnabled(): boolean;
  sessionStart(payload: {
    sessionId: string;
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
    sampleRate: number;
    channels: number;
  }): Promise<void>;
  audioAppend(payload: { sessionId: string; sequence: number; pcmBase64: string }): Promise<void>;
  sessionEnd(payload: { sessionId: string }): Promise<void>;
};

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

/** Subscribe to Discord voice per speaker and stream PCM to the STT pipeline. */
export class VoiceSttBridge {
  private readonly active = new Set<string>();

  constructor(
    private readonly client: SttBridgeClient,
    private readonly occupancy: VoiceOccupancy,
  ) {}

  attachConnection(
    connection: VoiceConnection,
    guildId: string,
    channelId: string,
    resolveDisplayName: (userId: string) => string,
    isBotUser: (userId: string) => boolean,
  ): void {
    connection.receiver.speaking.on("start", (userId) => {
      if (isBotUser(userId) || !this.client.isEnabled()) return;
      const captureKey = `${guildId}:${channelId}:${userId}`;
      if (this.active.has(captureKey)) return;

      this.active.add(captureKey);
      this.occupancy.captureStarted(guildId, channelId);
      const sessionId = `${captureKey}:${Date.now()}`;
      const displayName = resolveDisplayName(userId);
      let sequence = 0;

      void this.client
        .sessionStart({
          sessionId,
          guildId,
          channelId,
          userId,
          displayName,
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
        })
        .catch((err) => {
          console.warn("[discord/stt] session start failed", err);
        });

      const opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 400,
        },
      });

      type OpusDecoderCtor = new (opts: {
        frameSize: number;
        channels: number;
        rate: number;
      }, opus?: typeof OpusScript) => prism.opus.Decoder;
      const Decoder = prism.opus.Decoder as unknown as OpusDecoderCtor;
      const decoder = new Decoder(
        {
          frameSize: 960,
          channels: CHANNELS,
          rate: SAMPLE_RATE,
        },
        OpusScript,
      );

      opusStream.pipe(decoder);

      decoder.on("data", (chunk: Buffer) => {
        sequence += 1;
        void this.client
          .audioAppend({
            sessionId,
            sequence,
            pcmBase64: chunk.toString("base64"),
          })
          .catch(() => {});
      });

      const finish = () => {
        this.active.delete(captureKey);
        this.occupancy.captureEnded(guildId, channelId);
        void this.client.sessionEnd({ sessionId }).catch(() => {});
      };

      decoder.on("end", finish);
      decoder.on("close", finish);
      opusStream.on("error", finish);
      decoder.on("error", finish);
    });
  }
}
