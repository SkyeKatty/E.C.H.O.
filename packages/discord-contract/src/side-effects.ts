const IMMUTABLE = new Set([
  "discord.voice.join",
  "discord.voice.leave",
  "discord.channels.list",
]);

export function normalizeDiscordCapabilityId(capabilityId: string): string {
  if (capabilityId.startsWith("discord.")) return capabilityId;
  if (capabilityId.startsWith("discord_")) {
    return capabilityId.replace(/^discord_/, "discord.").replace(/_/g, ".");
  }
  return capabilityId;
}

/** Must complete even when chat is cancelled or another message arrives. */
export function isDiscordSideEffectCapability(capabilityId: string): boolean {
  return IMMUTABLE.has(normalizeDiscordCapabilityId(capabilityId));
}
