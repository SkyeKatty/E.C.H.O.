import { describe, expect, it } from "vitest";
import { discordRuntimeConfigSchema } from "@echo/discord-contract";
import { formatDiscordChannelDirectory } from "./channel-directory.js";

describe("formatDiscordChannelDirectory", () => {
  it("includes guild id and channel names", () => {
    const config = discordRuntimeConfigSchema.parse({ enabled: true, guildId: "g1" });
    const text = formatDiscordChannelDirectory(
      config,
      {
        guildId: "g1",
        guildName: "Test Guild",
        channels: [
          {
            channelId: "c1",
            name: "lounge",
            kind: "voice",
            textEnabled: false,
            voiceEnabled: true,
          },
        ],
      },
    );
    expect(text).toContain("guildId `g1`");
    expect(text).toContain("lounge");
    expect(text).toContain("channelId `c1`");
    expect(text).toContain("channelName");
  });
});
