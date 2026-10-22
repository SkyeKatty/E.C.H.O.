import type { DiscordChannelsList, DiscordRuntimeConfig } from "@echo/discord-contract";

export function formatDiscordChannelDirectory(
  config: DiscordRuntimeConfig,
  list: DiscordChannelsList,
): string {
  const lines = list.channels.map((c) => {
    const flags = [
      c.kind === "voice" ? "voice" : "text",
      c.textEnabled ? "text-on" : "text-off",
      c.voiceEnabled ? "voice-on" : "voice-off",
    ].join(", ");
    const prefix = c.kind === "text" ? "#" : "🔊";
    return `- ${prefix}${c.name} — channelId \`${c.channelId}\` (${flags})`;
  });

  const guildLine = config.guildId
    ? `Guild **${list.guildName}** — guildId \`${list.guildId}\``
    : `Guild **${list.guildName}** — guildId \`${list.guildId}\``;

  return [
    "## Discord channels (for tools)",
    guildLine,
    "Use **channelName** or **channelId** in discord.voice.join / leave / message.send.",
    "Voice join/leave accepts channelName (e.g. Lounge) without needing the snowflake id.",
    "",
    ...lines,
  ].join("\n");
}
