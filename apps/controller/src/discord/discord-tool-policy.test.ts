import { describe, expect, it } from "vitest";
import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import { discordSessionToolExclusions } from "./discord-tool-policy.js";

describe("discordSessionToolExclusions", () => {
  it("text mode blocks voice and auto message send", () => {
    const ex = discordSessionToolExclusions("text");
    expect(ex.has(DISCORD_CAPABILITIES.MESSAGE_SEND)).toBe(true);
    expect(ex.has(DISCORD_CAPABILITIES.VOICE_JOIN)).toBe(true);
    expect(ex.has(DISCORD_CAPABILITIES.VOICE_SPEAK)).toBe(true);
  });

  it("voice mode blocks message send and direct speak (TTS pipeline only)", () => {
    const ex = discordSessionToolExclusions("voice");
    expect(ex.has(DISCORD_CAPABILITIES.MESSAGE_SEND)).toBe(true);
    expect(ex.has(DISCORD_CAPABILITIES.VOICE_SPEAK)).toBe(true);
    expect(ex.has(DISCORD_CAPABILITIES.VOICE_JOIN)).toBe(false);
  });
});
