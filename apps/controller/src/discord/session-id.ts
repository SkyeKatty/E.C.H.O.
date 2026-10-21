import { createHash } from "node:crypto";

/** Stable UUID-shaped id for memory session `(personaId, sessionId)` per Discord text channel. */
export function discordTextSessionId(guildId: string, channelId: string): string {
  const d = createHash("sha256").update(`discord:text:${guildId}:${channelId}`).digest();
  d[6] = (d[6]! & 0x0f) | 0x40;
  d[8] = (d[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(d.subarray(0, 16)).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
