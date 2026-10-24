import type { DiscordRuntimeConfig } from "@echo/discord-contract";
import {
  discordChannelActivitySchema,
  discordInboundBatchSchema,
  type discordInboundMessageSchema,
} from "@echo/discord-contract";
import type { z } from "zod";
import type { SttBridgeClient } from "./voice-stt-bridge.js";

type InboundMessage = z.infer<typeof discordInboundMessageSchema>;

export class ControllerClient {
  private sttModuleAvailable = false;
  private sttStatusCheckedAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
    return h;
  }

  async postActivity(payload: { guildId: string; channelId: string; text: string }): Promise<void> {
    const body = discordChannelActivitySchema.parse(payload);
    const res = await fetch(`${this.baseUrl}/api/v1/discord/activity`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`activity failed: ${res.status} ${err}`);
    }
  }

  async postInbound(messages: InboundMessage[]): Promise<void> {
    const body = discordInboundBatchSchema.parse({ messages });
    const res = await fetch(`${this.baseUrl}/api/v1/discord/inbound`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`inbound failed: ${res.status} ${err}`);
    }
  }

  async postVoiceInterrupt(payload: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
  }): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/discord/voice/interrupt`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
  }

  async postVoiceTranscript(payload: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
    text: string;
    final: boolean;
  }): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/discord/voice/transcript`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
  }

  async refreshSttAvailability(): Promise<boolean> {
    const now = Date.now();
    if (now - this.sttStatusCheckedAt < 15_000) {
      return this.sttModuleAvailable;
    }
    this.sttStatusCheckedAt = now;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/stt/status`);
      if (!res.ok) return this.sttModuleAvailable;
      const data = (await res.json()) as { moduleAvailable?: boolean };
      this.sttModuleAvailable = Boolean(data.moduleAvailable);
    } catch {
      this.sttModuleAvailable = false;
    }
    return this.sttModuleAvailable;
  }

  createSttBridgeClient(): SttBridgeClient {
    return {
      isEnabled: () => this.sttModuleAvailable,
      sessionStart: (payload) => this.postSttSessionStart(payload),
      audioAppend: (payload) => this.postSttAudio(payload),
      sessionEnd: (payload) => this.postSttSessionEnd(payload),
    };
  }

  private async postSttSessionStart(payload: {
    sessionId: string;
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
    sampleRate: number;
    channels: number;
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/stt/session/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`stt session start failed: ${res.status} ${err}`);
    }
  }

  private async postSttAudio(payload: {
    sessionId: string;
    sequence: number;
    pcmBase64: string;
  }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/stt/audio`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ...payload, encoding: "pcm_s16le" }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`stt audio failed: ${res.status} ${err}`);
    }
  }

  private async postSttSessionEnd(payload: { sessionId: string }): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/stt/session/end`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`stt session end failed: ${res.status} ${err}`);
    }
  }

  async fetchSettings(): Promise<{ settings: Partial<DiscordRuntimeConfig> & { botTokenConfigured?: boolean } }> {
    const res = await fetch(`${this.baseUrl}/api/v1/discord/settings`);
    if (!res.ok) throw new Error(`settings fetch ${res.status}`);
    return res.json() as Promise<{ settings: Partial<DiscordRuntimeConfig> & { botTokenConfigured?: boolean } }>;
  }
}
