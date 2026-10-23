/** Maps memory/chat session ids to Discord channels (for timer replies and tool injection). */

export type DiscordSessionDelivery = {
  guildId: string;
  channelId: string;
};

const bySessionId = new Map<string, DiscordSessionDelivery>();

export function registerDiscordSession(
  sessionId: string,
  guildId: string,
  channelId: string,
): void {
  bySessionId.set(sessionId, { guildId, channelId });
}

export function getDiscordDeliveryForSession(sessionId: string): DiscordSessionDelivery | undefined {
  return bySessionId.get(sessionId);
}
