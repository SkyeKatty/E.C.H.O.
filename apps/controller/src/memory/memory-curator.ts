import type { LlmBackend } from "../llm/llm-backend.js";
import type { EventLog } from "../persona/state.js";
import type { ParticipantRef } from "./participant.js";
import type { MemoryModuleService } from "./memory-module-service.js";

export type MemoryCuratorConfig = {
  enabled: boolean;
  minConfidence: number;
  minUserMessageLength: number;
  requestTimeoutMs: number;
};

const EXTRACTOR_SYSTEM = `You maintain long-term memory for a persona assistant.
Given one conversation turn, extract zero or more durable facts worth remembering later.

Return ONLY valid JSON (no markdown):
{"candidates":[{"content":"full fact sentence","summary":"short label","kind":"semantic"|"episodic","importance":0.0-1.0,"confidence":0.0-1.0}]}

Include ONLY stable information: preferences, relationships, biographical details, long-term goals, recurring context.
Skip: greetings, small talk, jokes, roleplay, instructions to the AI, transient moods, secrets the user did not clearly state as lasting.
If nothing qualifies, return {"candidates":[]}.`;

type ExtractResponse = {
  candidates?: {
    content?: string;
    summary?: string;
    kind?: "semantic" | "episodic";
    importance?: number;
    confidence?: number;
  }[];
};

export class MemoryCurator {
  constructor(
    private readonly llm: LlmBackend,
    private readonly memory: MemoryModuleService,
    private readonly eventLog: EventLog,
    private readonly config: MemoryCuratorConfig,
  ) {}

  processTurn(input: {
    personaId: string;
    sessionId: string;
    turnId: string;
    speaker?: ParticipantRef;
    userMessage: string;
    assistantReply: string;
  }): void {
    if (!this.config.enabled) return;
    void this.runTurn(input).catch((err) => {
      this.eventLog.append({
        type: "memory.warn",
        summary: `Auto memory extraction failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    });
  }

  private async runTurn(input: {
    personaId: string;
    sessionId: string;
    turnId: string;
    speaker?: ParticipantRef;
    userMessage: string;
    assistantReply: string;
  }): Promise<void> {
    if (!this.memory.isAvailable() || !this.llm.isAvailable()) return;
    if (!input.speaker) return;
    if (input.userMessage.trim().length < this.config.minUserMessageLength) return;

    const provider = await this.llm.createActiveProvider();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const result = await provider.complete({
        messages: [
          { role: "system", content: EXTRACTOR_SYSTEM },
          {
            role: "user",
            content: `Speaker: ${input.speaker.displayName} (${input.speaker.key})\nUser message:\n${input.userMessage}\n\nAssistant reply:\n${input.assistantReply}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 600,
        signal: controller.signal,
      });

      const parsed = parseExtractorJson(result.message.content ?? "");
      const candidates = parsed.candidates ?? [];
      let proposed = 0;

      for (const raw of candidates) {
        const content = raw.content?.trim();
        if (!content || content.length < 8) continue;
        const confidence = clamp01(raw.confidence ?? 0.5);
        if (confidence < this.config.minConfidence) continue;

        const response = await this.memory.propose({
          personaId: input.personaId,
          kind: raw.kind === "episodic" ? "episodic" : "semantic",
          content,
          summary: raw.summary?.slice(0, 500) ?? content.slice(0, 120),
          confidence,
          importance: clamp01(raw.importance ?? 0.5),
          subject: input.speaker,
          source: {
            type: "conversation",
            sourceId: input.sessionId,
            excerpt: input.userMessage.slice(0, 500),
          },
        });

        proposed += 1;
        const body = response as { duplicate?: boolean; lifecycleState?: string; memoryId?: string };
        if (!body.duplicate && body.lifecycleState === "active") {
          this.eventLog.append({
            type: "memory.stored",
            summary: `Remembered: ${content.slice(0, 72)}${content.length > 72 ? "…" : ""}`,
          });
        }
      }

      if (proposed > 0) {
        this.eventLog.append({
          type: "memory.extract",
          summary: `Processed ${proposed} memory candidate(s) from chat turn ${input.turnId.slice(0, 8)}`,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function parseExtractorJson(text: string): ExtractResponse {
  const trimmed = text.trim();
  const jsonBlock = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonBlock) return { candidates: [] };
  try {
    return JSON.parse(jsonBlock[0]) as ExtractResponse;
  } catch {
    return { candidates: [] };
  }
}
