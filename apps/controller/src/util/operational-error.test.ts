import { describe, expect, it } from "vitest";
import { describeOperationalError, isAbortLike } from "./operational-error.js";

describe("operational-error", () => {
  it("detects abort-like errors", () => {
    expect(isAbortLike(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortLike(new Error("The operation was aborted."))).toBe(true);
  });

  it("enriches opaque abort messages", () => {
    const { message, logLine } = describeOperationalError(new Error("The operation was aborted."), {
      capabilityId: "discord.voice.join",
      timeoutMs: 30_000,
    });
    expect(message).toContain("Discord voice timed out");
    expect(message).not.toContain("parent task cancelled");
    expect(logLine).toContain("discord.voice.join");
  });
});
