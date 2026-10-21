import { describe, expect, it } from "vitest";
import { assembleChatMessages } from "./context.js";
import type { CharacterCard } from "../characters/schema.js";

const card: CharacterCard = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  referenceImages: [],
};

describe("assembleChatMessages", () => {
  it("injects memory block and limits history when configured", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }));
    const messages = assembleChatMessages({
      character: card,
      policy: { behavioralGuidelines: "Stay in character." },
      state: {
        name: "Test",
        activeCharacterId: card.id,
        activity: "idle",
        focus: "x",
        channel: "dashboard",
        reactiveOnly: true,
        processingPaused: false,
        autonomyEnabled: false,
        activeModel: null,
        activeProvider: null,
        pendingActions: 0,
        lastEventSummary: null,
      },
      history,
      userMessage: "hello",
      memoryInjection: "## Retrieved memory\n- user likes tea",
      historyLimit: 5,
    });
    expect(messages[0].content).toContain("Retrieved memory");
    expect(messages.filter((m) => m.role === "user").length).toBe(6);
  });
});
