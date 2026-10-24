import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import type { DiscordSessionDelivery } from "./session-delivery.js";

/** Fill channel/guild ids from the active Discord session when the model omits them. */
export function applyDiscordSessionToolDefaults(
  capabilityId: string,
  params: unknown,
  delivery: DiscordSessionDelivery,
): unknown {
  if (!capabilityId.startsWith("discord.")) return params;

  const base =
    typeof params === "object" && params !== null
      ? { ...(params as Record<string, unknown>) }
      : {};

  if (
    typeof base.input === "string" &&
    !base.query &&
    !base.channelId &&
    (capabilityId === DISCORD_CAPABILITIES.VOICE_JOIN ||
      capabilityId === DISCORD_CAPABILITIES.VOICE_LEAVE ||
      capabilityId === DISCORD_CAPABILITIES.VOICE_SPEAK)
  ) {
    base.query = base.input;
    delete base.input;
  }

  switch (capabilityId) {
    case DISCORD_CAPABILITIES.MESSAGE_SEND:
    case DISCORD_CAPABILITIES.MESSAGE_REACT:
    case DISCORD_CAPABILITIES.MESSAGE_REACTIONS_GET:
      if (!base.channelId) base.channelId = delivery.channelId;
      break;
    case DISCORD_CAPABILITIES.EMOJI_LIST:
    case DISCORD_CAPABILITIES.MEMBER_RESOLVE:
    case DISCORD_CAPABILITIES.VOICE_JOIN:
    case DISCORD_CAPABILITIES.VOICE_LEAVE:
    case DISCORD_CAPABILITIES.VOICE_SPEAK:
    case DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL:
      if (!base.guildId) base.guildId = delivery.guildId;
      break;
    default:
      break;
  }

  return base;
}
