import { createHash } from "node:crypto";

function sessionUuidFromSeed(seed: string): string {
  const d = createHash("sha256").update(seed).digest();
  d[6] = (d[6]! & 0x0f) | 0x40;
  d[8] = (d[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(d.subarray(0, 16)).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Stable session id per Discord text channel (memory + chat). */
export function discordTextSessionId(guildId: string, channelId: string): string {
  return sessionUuidFromSeed(`discord:text:${guildId}:${channelId}`);
}

/** Separate session for voice STT turns — does not share history with text channel chat. */
export function discordVoiceSessionId(guildId: string, channelId: string): string {
  return sessionUuidFromSeed(`discord:voice:${guildId}:${channelId}`);
}
