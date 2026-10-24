import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import type { DiscordSessionMode } from "./session-delivery.js";

const DISCORD_VOICE_CAPABILITIES = new Set<string>([
  DISCORD_CAPABILITIES.VOICE_JOIN,
  DISCORD_CAPABILITIES.VOICE_LEAVE,
  DISCORD_CAPABILITIES.VOICE_STATUS,
  DISCORD_CAPABILITIES.VOICE_SPEAK,
  DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL,
  DISCORD_CAPABILITIES.VOICE_AWAIT_SILENCE,
]);

/** Capabilities the LLM must not invoke for this Discord session kind. */
export function discordSessionToolExclusions(mode: DiscordSessionMode): ReadonlySet<string> {
  const exclude = new Set<string>([DISCORD_CAPABILITIES.MESSAGE_SEND]);
  if (mode === "text") {
    for (const id of DISCORD_VOICE_CAPABILITIES) exclude.add(id);
  }
  if (mode === "voice") {
    exclude.add(DISCORD_CAPABILITIES.VOICE_SPEAK);
    exclude.add(DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL);
  }
  return exclude;
}
