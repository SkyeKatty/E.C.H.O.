import type { ParticipantRef } from "../memory/participant.js";

export function discordParticipant(guildId: string, userId: string, displayName: string): ParticipantRef {
  return {
    key: `discord:${guildId}:${userId}`,
    displayName,
    kind: "user",
  };
}
