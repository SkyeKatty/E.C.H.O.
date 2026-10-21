import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./constants.js";
import { createEnvelope, parseEnvelope, safeParseEnvelope } from "./envelope.js";

describe("envelope", () => {
  it("creates valid envelopes", () => {
    const env = createEnvelope({
      type: "module.heartbeat",
      source: "mock-1",
      payload: { moduleId: "mock-1" },
    });
    expect(env.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(() => parseEnvelope(env)).not.toThrow();
  });

  it("rejects invalid protocol version", () => {
    const bad = {
      ...createEnvelope({ type: "x", source: "a", payload: {} }),
      protocolVersion: "99",
    };
    expect(safeParseEnvelope(bad).success).toBe(false);
  });

  it("rejects missing messageId", () => {
    const env = createEnvelope({ type: "x", source: "a", payload: {} });
    const { messageId: _, ...rest } = env;
    expect(safeParseEnvelope(rest).success).toBe(false);
  });
});
