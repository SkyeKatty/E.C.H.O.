import {
  TTS_CAPABILITIES,
  ttsConfigApplySchema,
  ttsRuntimeConfigSchema,
  ttsSpeechEnqueueSchema,
  ttsSpeechFlushSchema,
  type TtsRuntimeConfig,
} from "@echo/voice-contract";
import { ControllerClient } from "./controller-client.js";
import { synthesizeFish } from "./providers/fish.js";
import { synthesizeOpenRouter } from "./providers/openrouter.js";

type QueueItem = {
  streamId: string;
  sequence: number;
  text: string;
  sink?: string;
  flush?: boolean;
};

export class TtsRuntime {
  private config: TtsRuntimeConfig = ttsRuntimeConfigSchema.parse({});
  private openRouterApiKey: string | null = null;
  private readonly queue: QueueItem[] = [];
  private worker: Promise<void> = Promise.resolve();
  private prefetch: Promise<{ audioBase64: string; mimeType: string } | null> | null = null;
  private prefetchKey: string | null = null;

  constructor(private readonly controller: ControllerClient) {}

  getStatus() {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      queueDepth: this.queue.length,
      fishBaseUrl: this.config.fishBaseUrl,
      openRouterConfigured: Boolean(this.openRouterApiKey),
    };
  }

  applyConfig(raw: unknown): { applied: boolean } {
    const parsed = ttsConfigApplySchema.parse(raw);
    if (parsed.openRouterApiKey) {
      this.openRouterApiKey = parsed.openRouterApiKey.trim();
    }
    const { openRouterApiKey: _k, ...rest } = parsed;
    this.config = ttsRuntimeConfigSchema.parse(rest);
    return { applied: true };
  }

  enqueue(raw: unknown): { queued: true; queueDepth: number } {
    const item = ttsSpeechEnqueueSchema.parse(raw);
    if (!this.config.enabled) {
      return { queued: true, queueDepth: 0 };
    }
    this.queue.push(item);
    while (this.queue.length > this.config.maxQueueDepth) {
      this.queue.shift();
      console.warn("[tts] Queue overflow — dropped oldest utterance");
    }
    this.scheduleWorker();
    return { queued: true, queueDepth: this.queue.length };
  }

  flush(raw: unknown): { queued: boolean } {
    const body = ttsSpeechFlushSchema.parse(raw);
    if (body.tailText?.trim()) {
      this.enqueue({
        streamId: body.streamId,
        sequence: 1_000_000,
        text: body.tailText.trim(),
        sink: body.sink,
        flush: true,
      });
    } else {
      this.queue.push({
        streamId: body.streamId,
        sequence: 1_000_001,
        text: "",
        sink: body.sink,
        flush: true,
      });
      this.scheduleWorker();
    }
    return { queued: true };
  }

  private scheduleWorker(): void {
    this.worker = this.worker.then(() => this.runWorker()).catch((err) => {
      console.error("[tts] Worker error:", err instanceof Error ? err.message : err);
    });
  }

  private async runWorker(): Promise<void> {
    if (!this.config.enabled) return;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.text.trim().length === 0 && item.flush) {
        continue;
      }

      const synthKey = `${item.streamId}:${item.sequence}`;
      let audio: { audioBase64: string; mimeType: string };

      if (this.prefetch && this.prefetchKey === synthKey) {
        const pref = await this.prefetch;
        this.prefetch = null;
        this.prefetchKey = null;
        if (!pref) {
          audio = await this.synthesize(item.text);
        } else {
          audio = pref;
        }
      } else {
        this.prefetch = null;
        this.prefetchKey = null;
        audio = await this.synthesize(item.text);
      }

      const next = this.queue[0];
      if (this.config.prefetchNext && next?.text.trim()) {
        const nextKey = `${next.streamId}:${next.sequence}`;
        this.prefetchKey = nextKey;
        this.prefetch = this.synthesize(next.text).catch(() => null);
      }

      await this.controller.postPlayback({
        streamId: item.streamId,
        sequence: item.sequence,
        sink: item.sink,
        text: item.text,
        mimeType: audio.mimeType,
        audioBase64: audio.audioBase64,
        buffered: true,
      });
    }
  }

  private async synthesize(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    if (this.config.provider === "openrouter") {
      const key = this.openRouterApiKey ?? process.env.OPENROUTER_API_KEY?.trim();
      if (!key) throw new Error("OpenRouter API key not configured for TTS");
      return synthesizeOpenRouter(this.config, text, key);
    }
    return synthesizeFish(this.config, text);
  }
}

export const capabilityList = [
  {
    id: TTS_CAPABILITIES.HEALTH_GET,
    name: "TTS health",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: TTS_CAPABILITIES.CONFIG_APPLY,
    name: "Apply TTS config",
    version: "1.0.0",
    enabled: false,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: TTS_CAPABILITIES.CONFIG_STATUS,
    name: "TTS config status",
    version: "1.0.0",
    enabled: false,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: TTS_CAPABILITIES.SPEECH_ENQUEUE,
    name: "Enqueue TTS utterance",
    description: "Queue text for synthesis and playback routing",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: TTS_CAPABILITIES.SPEECH_FLUSH,
    name: "Flush TTS stream",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
] as const;
