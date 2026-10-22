import type { DiscordChannelsList } from "@echo/discord-contract";

export type ChannelInfo = DiscordChannelsList["channels"][number];

export function pickVoiceChannel(
  channels: ChannelInfo[],
  input: { channelId?: string; channelName?: string },
): ChannelInfo {
  if (input.channelId?.trim()) {
    const id = input.channelId.trim();
    const hit = channels.find((c) => c.channelId === id && c.kind === "voice");
    if (!hit) throw new Error(`No voice channel with id ${id}`);
    return hit;
  }

  const name = input.channelName?.trim();
  if (!name) throw new Error("channelId or channelName is required");

  const voice = channels.filter((c) => c.kind === "voice");
  const lower = name.toLowerCase();
  const exact = voice.filter((c) => c.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(`Ambiguous voice channel name "${name}" (${exact.map((c) => c.channelId).join(", ")})`);
  }

  const partial = voice.filter(
    (c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()),
  );
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new Error(
      `Ambiguous voice channel name "${name}" — matches: ${partial.map((c) => c.name).join(", ")}`,
    );
  }

  throw new Error(`No voice channel matching name "${name}"`);
}
