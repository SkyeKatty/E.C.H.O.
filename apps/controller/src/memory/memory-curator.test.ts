import { describe, expect, it } from "vitest";

// JSON parsing behavior mirrored from curator (inline test helper)
function parseCandidates(text: string) {
  const jsonBlock = text.trim().match(/\{[\s\S]*\}/);
  if (!jsonBlock) return [];
  const parsed = JSON.parse(jsonBlock[0]) as { candidates?: { content?: string }[] };
  return parsed.candidates ?? [];
}

describe("memory curator extraction JSON", () => {
  it("parses fenced JSON from model output", () => {
    const raw = 'Here you go:\n{"candidates":[{"content":"User prefers tea over coffee.","confidence":0.9}]}';
    expect(parseCandidates(raw)).toHaveLength(1);
  });
});
