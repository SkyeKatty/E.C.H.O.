import { describe, expect, it } from "vitest";
import { buildCharacterSystemPrompt } from "./prompt.js";
import type { CharacterCard } from "./schema.js";

const sampleCard: CharacterCard = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Aria",
  summary: "A curious archivist.",
  personality: "Warm, precise.",
  mannerisms: "Pauses before answering.",
  speechStyle: "Short sentences.",
  physicalAppearance: "Silver hair, green coat.",
  background: "Maintains the memory vault.",
  behavioralRules: "Never breaks the fourth wall.",
  referenceImages: [{ id: "00000000-0000-4000-8000-000000000002", caption: "Portrait" }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("buildCharacterSystemPrompt", () => {
  it("includes character sections and runtime policy", () => {
    const text = buildCharacterSystemPrompt({
      card: sampleCard,
      state: {
        name: "Aria",
        activeCharacterId: sampleCard.id,
        activity: "idle",
        focus: "conversation",
        channel: "dashboard",
        reactiveOnly: true,
        processingPaused: false,
        autonomyEnabled: false,
        activeModel: null,
        activeProvider: null,
        pendingActions: 0,
        lastEventSummary: null,
      },
      policy: { behavioralGuidelines: "Follow safety policy." },
    });
    expect(text).toContain("You are Aria");
    expect(text).toContain("Physical appearance");
    expect(text).toContain("Silver hair");
    expect(text).toContain("Follow safety policy");
  });
});
