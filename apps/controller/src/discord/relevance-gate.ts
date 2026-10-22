import type { CharacterCard } from "../characters/schema.js";
import type { LlmBackend } from "../llm/llm-backend.js";

export type GateInput = {
  character: CharacterCard;
  channelLabel: string;
  /** New message to evaluate (speaker: text). */
  currentMessage: string;
  /** Messages the persona already chose to ignore since their last reply (context only). */
  skippedContext?: string;
  mentionedBot: boolean;
  referencedBot: boolean;
};

export type GateResult = {
  shouldRespond: boolean;
  reason: string;
};

const SYSTEM = `Discord gate: would this persona actually post a reply to the NEW line right now?
Output JSON only: {"shouldRespond":boolean,"reason":"≤5 words"}

Default false. Busy channel — silence is normal. Say true only if they'd clearly speak up now (not merely "could comment").

true — strong pull: directly addressed, question to them, sharp match to interests/values, they'd regret staying quiet, or a rare hook they'd jump on.
false — everything else: mild interest, banter they'd lurk through, side threads, repeats, filler, or anything they'd let pass without typing.

Skipped lines = what they already ignored since last reply; lean false unless the NEW line is a clear reason to break silence.`;

/** Reasoning models need headroom; visible JSON often lands after thinking tokens. */
const GATE_MAX_TOKENS = 1024;

function gateModelText(message: { content: string | null; reasoning?: string | null }): string {
  const parts = [message.content, message.reasoning].map((s) => s?.trim()).filter(Boolean) as string[];
  return parts.join("\n");
}

function parseGateJson(text: string): GateResult | null {
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

export async function evaluateDiscordRelevance(
  llm: LlmBackend,
  input: GateInput,
  timeoutMs: number,
  hooks?: { onError?: (message: string) => void },
): Promise<GateResult> {
  if (!llm.isAvailable()) {
    return { shouldRespond: false, reason: "llm_unavailable" };
  }

  const provider = await llm.createProviderForTask("discord_gate");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const skippedBlock = input.skippedContext?.trim()
    ? `Skipped since last reply:\n${input.skippedContext}\n\n`
    : "";

  try {
    const card = input.character;
    const personality = card.personality?.trim().slice(0, 400) ?? "";
    const result = await provider.complete({
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `${card.name}${personality ? ` — ${personality}` : ""} · ${input.channelLabel}

${skippedBlock}New: ${input.currentMessage}`,
        },
      ],
      temperature: 0.2,
      maxTokens: GATE_MAX_TOKENS,
      signal: controller.signal,
    });

    const text = gateModelText(result.message);
    const parsed = parseGateJson(text);
    if (parsed) return parsed;
    if (result.finishReason === "length") {
      return { shouldRespond: false, reason: "gate_truncated" };
    }
    return { shouldRespond: false, reason: "parse_failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    hooks?.onError?.(message);
    return { shouldRespond: false, reason: "gate_error" };
  } finally {
    clearTimeout(timer);
  }
}
