import {
  STT_CAPABILITIES,
  sttAudioAppendSchema,
  sttConfigApplySchema,
  sttRuntimeConfigSchema,
  sttSessionEndSchema,
  sttSessionStartSchema,
  type SttRuntimeConfig,
} from "@echo/voice-contract";
import { ControllerClient } from "./controller-client.js";
import { transcribePcm } from "./providers/transcribe.js";

type SessionState = {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  userId: string;
  displayName: string;
  sampleRate: number;
  channels: number;
  chunks: Buffer[];
  startedAt: number;
  timeout: ReturnType<typeof setTimeout> | null;
};

export class SttRuntime {
  private config: SttRuntimeConfig = sttRuntimeConfigSchema.parse({});
  private groqApiKey: string | null = null;
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly controller: ControllerClient) {}

  getStatus() {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      transcriptionBaseUrl: this.config.transcriptionBaseUrl,
      model: this.config.model,
      activeSessions: this.sessions.size,
      groqConfigured: Boolean(this.groqApiKey ?? process.env.GROQ_API_KEY?.trim()),
    };
  }

  applyConfig(raw: unknown): { applied: boolean } {
    const parsed = sttConfigApplySchema.parse(raw);
    if (parsed.groqApiKey) {
      this.groqApiKey = parsed.groqApiKey.trim();
    }
    const { groqApiKey: _k, ...rest } = parsed;
    this.config = sttRuntimeConfigSchema.parse(rest);
    return { applied: true };
  }

  sessionStart(raw: unknown): { started: true } {
    const body = sttSessionStartSchema.parse(raw);
    if (!this.config.enabled) return { started: true };

    this.clearSession(body.sessionId);

    const timeout = setTimeout(() => {
      void this.sessionEnd({ sessionId: body.sessionId }).catch(() => {});
    }, this.config.maxSessionSeconds * 1000);

    this.sessions.set(body.sessionId, {
      sessionId: body.sessionId,
      guildId: body.guildId,
      channelId: body.channelId,
      userId: body.userId,
      displayName: body.displayName,
      sampleRate: body.sampleRate,
      channels: body.channels,
      chunks: [],
      startedAt: Date.now(),
      timeout,
    });
    return { started: true };
  }

  audioAppend(raw: unknown): { appended: true } {
    const body = sttAudioAppendSchema.parse(raw);
    if (!this.config.enabled) return { appended: true };
    const session = this.sessions.get(body.sessionId);
    if (!session) return { appended: true };
    session.chunks.push(Buffer.from(body.pcmBase64, "base64"));
    return { appended: true };
  }

  async sessionEnd(raw: unknown): Promise<{ ended: true; transcribed?: boolean }> {
    const body = sttSessionEndSchema.parse(raw);
    const session = this.sessions.get(body.sessionId);
    if (!session) return { ended: true };

    this.clearSession(body.sessionId);
    const pcm = Buffer.concat(session.chunks);
    if (pcm.length < session.sampleRate * session.channels * 0.15) {
      return { ended: true, transcribed: false };
    }

    try {
      const text = await transcribePcm(
        this.config,
        pcm,
        session.sampleRate,
        session.channels,
        this.groqApiKey,
      );
      if (!text || !session.guildId || !session.channelId) {
        return { ended: true, transcribed: false };
      }
      await this.controller.postVoiceTranscript({
        guildId: session.guildId,
        channelId: session.channelId,
        userId: session.userId,
        displayName: session.displayName,
        text,
        final: true,
      });
      return { ended: true, transcribed: true };
    } catch (err) {
      console.error("[stt] Transcription failed:", err instanceof Error ? err.message : err);
      return { ended: true, transcribed: false };
    }
  }

  private clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.timeout) clearTimeout(session.timeout);
    this.sessions.delete(sessionId);
  }
}

export const capabilityList = [
  {
    id: STT_CAPABILITIES.HEALTH_GET,
    name: "STT health",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: STT_CAPABILITIES.CONFIG_APPLY,
    name: "Apply STT config",
    version: "1.0.0",
    enabled: false,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: STT_CAPABILITIES.CONFIG_STATUS,
    name: "STT config status",
    version: "1.0.0",
    enabled: false,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: STT_CAPABILITIES.SESSION_START,
    name: "Start STT capture session",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: true,
    supportsCancellation: false,
  },
  {
    id: STT_CAPABILITIES.AUDIO_APPEND,
    name: "Append PCM audio to STT session",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: true,
    supportsCancellation: false,
  },
  {
    id: STT_CAPABILITIES.SESSION_END,
    name: "End STT session and transcribe",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
  },
] as const;
