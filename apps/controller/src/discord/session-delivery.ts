/** Maps memory/chat session ids to Discord channels (for timer replies and tool injection). */

export type DiscordSessionMode = "text" | "voice";

export type DiscordSessionDelivery = {
  guildId: string;
  channelId: string;
  mode: DiscordSessionMode;
};

const bySessionId = new Map<string, DiscordSessionDelivery>();

export function registerDiscordSession(
  sessionId: string,
  guildId: string,
  channelId: string,
  mode: DiscordSessionMode = "text",
): void {
  bySessionId.set(sessionId, { guildId, channelId, mode });
}

export function getDiscordDeliveryForSession(sessionId: string): DiscordSessionDelivery | undefined {
  return bySessionId.get(sessionId);
}
