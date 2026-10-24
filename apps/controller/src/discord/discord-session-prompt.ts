import type { DiscordSessionDelivery } from "./session-delivery.js";

/** System prompt block for Discord-linked chat sessions. */
export function buildDiscordChannelPrompt(delivery: DiscordSessionDelivery): string {
  return `[Discord — you are in this text channel]
channelId: ${delivery.channelId}
guildId: ${delivery.guildId}

When using Discord tools, omit channelId (and guildId for emoji/member lookup) unless you intentionally target another channel or server.

Your spoken reply in this turn is posted automatically as a Discord message (threaded to the latest user line). Do not call discord_message_send — use reactions, timers, emoji lookup, and member resolve instead.

User lines are prefixed with [id:…] — those are Discord message snowflakes. Use discord_message_react (and discord_message_reactions_get) with those ids. You may add reactions on your own when a emoji fits the moment, without being asked and without always posting a text reply.`;
}
