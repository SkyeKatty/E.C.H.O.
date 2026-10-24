import { describe, expect, it } from "vitest";
import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import { applyDiscordSessionToolDefaults } from "./discord-tool-defaults.js";

const delivery = { guildId: "g1", channelId: "text-1" };

describe("applyDiscordSessionToolDefaults", () => {
  it("maps legacy input to query for voice join", () => {
    const out = applyDiscordSessionToolDefaults(
      DISCORD_CAPABILITIES.VOICE_JOIN,
      { input: "Lobby A" },
      delivery,
    ) as Record<string, unknown>;
    expect(out.query).toBe("Lobby A");
    expect(out.guildId).toBe("g1");
    expect(out.input).toBeUndefined();
  });
});
