import type { CharacterCard } from "../characters/schema.js";
import type { LlmBackend } from "../llm/llm-backend.js";

export type GateInput = {
  character: CharacterCard;
  channelLabel: string;
  /** New message to evaluate (speaker: text). */
  currentMessage: string;
  /** Ordered channel transcript for the gate window (users + persona; excludes the new message). */
  skippedContext?: string;
  mentionedBot: boolean;
  referencedBot: boolean;
};

export type GateResult = {
  shouldRespond: boolean;
  reason: string;
};

function buildGateSystem(characterName: string): string {
  return `You decide whether ${characterName} would speak up in a Discord text channel given ONE new message.
Return ONLY JSON: {"shouldRespond":boolean,"reason":"short phrase"}

Respond true when ${characterName} would naturally join now (direct question, strong relevance, emotional moment, or she's being addressed).
Respond false when ${characterName} would stay silent for this new message (side chatter, not her business, already said enough).

Prior channel lines may be included in order before the new message — base the decision on the NEW message.`;
}

export async function evaluateDiscordRelevance(
  llm: LlmBackend,
  input: GateInput,
  timeoutMs: number,
): Promise<GateResult> {
  if (!llm.isAvailable()) {
    return { shouldRespond: false, reason: "llm_unavailable" };
  }

  const provider = await llm.createActiveProvider();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const skippedBlock = input.skippedContext?.trim() ? `${input.skippedContext}\n\n` : "";

  try {
    const card = input.character;
    const result = await provider.complete({
      messages: [
        { role: "system", content: buildGateSystem(card.name) },
        {
          role: "user",
          content: `Character: ${card.name}
Personality notes: ${card.personality?.slice(0, 800) ?? "(none)"}
Channel: ${input.channelLabel}

${skippedBlock}New message to evaluate:
${input.currentMessage}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 120,
      signal: controller.signal,
    });

    const text = result.message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { shouldRespond: false, reason: "parse_failed" };
    const parsed = JSON.parse(match[0]) as { shouldRespond?: boolean; reason?: string };
    return {
      shouldRespond: Boolean(parsed.shouldRespond),
      reason: typeof parsed.reason === "string" ? parsed.reason : "model",
    };
  } catch {
    return { shouldRespond: false, reason: "gate_error" };
  } finally {
    clearTimeout(timer);
  }
}
