import { discordConnectionFingerprint } from "@echo/discord-contract";
import type { DiscordRuntimeConfig } from "@echo/discord-contract";

export { discordConnectionFingerprint };

export function needsDiscordReconnect(
  prev: string | null,
  cfg: DiscordRuntimeConfig,
  clientReady: boolean,
): boolean {
  if (!cfg.enabled) return false;
  const fp = discordConnectionFingerprint(cfg);
  return fp !== prev || !clientReady;
}
