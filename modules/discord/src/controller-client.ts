import type { DiscordRuntimeConfig } from "@echo/discord-contract";
import { discordInboundBatchSchema, type discordInboundMessageSchema } from "@echo/discord-contract";
import type { z } from "zod";

type InboundMessage = z.infer<typeof discordInboundMessageSchema>;

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

  async fetchSettings(): Promise<{ settings: Partial<DiscordRuntimeConfig> & { botTokenConfigured?: boolean } }> {
    const res = await fetch(`${this.baseUrl}/api/v1/discord/settings`);
    if (!res.ok) throw new Error(`settings fetch ${res.status}`);
    return res.json() as Promise<{ settings: Partial<DiscordRuntimeConfig> & { botTokenConfigured?: boolean } }>;
  }
}
