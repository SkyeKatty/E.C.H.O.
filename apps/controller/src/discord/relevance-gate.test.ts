import { describe, expect, it } from "vitest";

// Test helpers mirrored from relevance-gate (export if we need more coverage later)
function gateModelText(message: { content: string | null; reasoning?: string | null }): string {
  const parts = [message.content, message.reasoning].map((s) => s?.trim()).filter(Boolean) as string[];
  return parts.join("\n");
}

function parseGateJson(text: string): { shouldRespond: boolean; reason: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { shouldRespond?: boolean; reason?: string };
    return {
      shouldRespond: Boolean(parsed.shouldRespond),
      reason: typeof parsed.reason === "string" ? parsed.reason : "model",
    };
  } catch {
    return null;
  }
}

describe("discord relevance gate parsing", () => {
  it("parses JSON from content", () => {
    const r = parseGateJson('{"shouldRespond":true,"reason":"hooked"}');
    expect(r?.shouldRespond).toBe(true);
  });

  it("parses JSON from reasoning when content empty", () => {
    const text = gateModelText({
      content: "",
      reasoning: 'Thought…\n{"shouldRespond":false,"reason":"boring"}',
    });
    expect(parseGateJson(text)?.shouldRespond).toBe(false);
  });
});
