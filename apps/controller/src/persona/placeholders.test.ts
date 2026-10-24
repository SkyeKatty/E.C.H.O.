import { describe, expect, it } from "vitest";
import {
  CHARACTER_NAME_PLACEHOLDER,
  expandPersonaPlaceholders,
  normalizeMemoryProse,
} from "./placeholders.js";

describe("expandPersonaPlaceholders", () => {
  it("replaces character name placeholders", () => {
    const text = `Memory for ${CHARACTER_NAME_PLACEHOLDER} and {{personaName}}.`;
    expect(expandPersonaPlaceholders(text, { characterName: "Lyra" })).toBe(
      "Memory for Lyra and Lyra.",
    );
  });
});

describe("normalizeMemoryProse", () => {
  it("rewrites generic assistant labels", () => {
    expect(normalizeMemoryProse("The persona felt happy.", "Lyra")).toBe("Lyra felt happy.");
  });
});
