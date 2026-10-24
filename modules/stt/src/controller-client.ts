import { discordVoiceTranscriptSchema } from "@echo/discord-contract";

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

  async postVoiceTranscript(payload: {
    guildId: string;
    channelId: string;
    userId: string;
    displayName: string;
    text: string;
    final: boolean;
  }): Promise<void> {
    const body = discordVoiceTranscriptSchema.parse(payload);
    const res = await fetch(`${this.baseUrl}/api/v1/discord/voice/transcript`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`voice transcript POST failed: ${res.status} ${err}`);
    }
  }
}
