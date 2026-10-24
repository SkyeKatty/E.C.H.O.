import { z } from "zod";

export const sttProviderSchema = z.enum(["local-http", "groq"]);

export const sttRuntimeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** OpenAI-compatible POST /audio/transcriptions (local whisper.cpp, speaches, etc.). */
  provider: sttProviderSchema.default("local-http"),
  transcriptionBaseUrl: z.string().url().default("http://127.0.0.1:8091/v1"),
  model: z.string().default("whisper-1"),
  language: z.string().optional(),
  /** Drop sessions that never receive audio end within this window. */
  maxSessionSeconds: z.number().int().min(5).max(120).default(45),
});

export type SttRuntimeConfig = z.infer<typeof sttRuntimeConfigSchema>;

export const sttConfigApplySchema = sttRuntimeConfigSchema.extend({
  groqApiKey: z.string().min(1).optional(),
});

export const sttSessionStartSchema = z.object({
  sessionId: z.string().min(1).max(128),
  guildId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  sampleRate: z.number().int().min(8000).max(48000).default(48000),
  channels: z.number().int().min(1).max(2).default(2),
});

export const sttAudioAppendSchema = z.object({
  sessionId: z.string().min(1).max(128),
  sequence: z.number().int().min(0),
  pcmBase64: z.string().min(1),
  encoding: z.enum(["pcm_s16le"]).default("pcm_s16le"),
});

export const sttSessionEndSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const ttsProviderSchema = z.enum(["fish", "openrouter"]);

export const ttsRuntimeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: ttsProviderSchema.default("fish"),
  /** Local Fish Speech (Fish Audio) API base — default port 8092. */
  fishBaseUrl: z.string().url().default("http://127.0.0.1:8092"),
  fishApiPath: z.string().default("/v1/tts"),
  /** OpenRouter model id for speech-capable endpoints (when provider is openrouter). */
  openRouterModel: z.string().default("openai/gpt-4o-audio-preview"),
  openRouterBaseUrl: z.string().url().default("https://openrouter.ai/api/v1"),
  /** Max queued utterances before back-pressure (drop oldest warning). */
  maxQueueDepth: z.number().int().min(1).max(500).default(64),
  /** Start synthesizing the next queued line while the current one plays. */
  prefetchNext: z.boolean().default(true),
  defaultMimeType: z.string().default("audio/wav"),
});

export type TtsRuntimeConfig = z.infer<typeof ttsRuntimeConfigSchema>;

export const ttsConfigApplySchema = ttsRuntimeConfigSchema.extend({
  openRouterApiKey: z.string().min(1).optional(),
});

export const ttsSpeechEnqueueSchema = z.object({
  streamId: z.string().min(1).max(128),
  sequence: z.number().int().min(0),
  text: z.string().min(1).max(4000),
  /** Routing hint: twitch, stt, discord_voice:guild:channel, etc. */
  sink: z.string().min(1).max(256).optional(),
  /** Last chunk for this LLM stream — flush queue tail after playback. */
  flush: z.boolean().optional(),
});

export const ttsSpeechFlushSchema = z.object({
  streamId: z.string().min(1).max(128),
  /** Any trailing text without sentence-ending punctuation. */
  tailText: z.string().max(4000).optional(),
  sink: z.string().min(1).max(256).optional(),
});

export const ttsPlaybackChunkSchema = z.object({
  streamId: z.string().min(1),
  sequence: z.number().int().min(0),
  sink: z.string().optional(),
  text: z.string(),
  mimeType: z.string().default("audio/wav"),
  audioBase64: z.string().min(1),
  /** True when the TTS module will not stream — whole chunk is available at once. */
  buffered: z.boolean().default(true),
});
