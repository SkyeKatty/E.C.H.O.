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

Memory scopes:
- participant: about one person (preferences, biography, how the persona feels about them — these can change over time)
- social: events involving multiple people (who was present, what happened together)
- general: persona/world facts with no specific person (plans, moods about life, environment, schedule)

Return ONLY valid JSON (no markdown):
{"candidates":[{
  "content":"full fact sentence in past or present tense",
  "summary":"short label",
  "kind":"semantic"|"episodic",
  "scope":"participant"|"social"|"general",
  "importance":0.0-1.0,
  "confidence":0.0-1.0,
  "occurredAt":"ISO-8601 datetime when the event happened, if known, else omit",
  "involvedKeys":["external participant keys besides the speaker, if social"],
  "aboutSpeaker":true if this participant-scoped memory is primarily about the current speaker,
  "evolvesPrior":true if this replaces or updates an earlier feeling/opinion about the same person
}]}

Include: stable preferences, relationships, multi-user events, timelines, and evolving attitudes toward people.
Extract how the persona feels about someone when stated or clearly implied; mark evolvesPrior when sentiment changed.
Skip: pure greetings, empty small talk, one-off jokes, meta instructions to the AI.
If nothing qualifies, return {"candidates":[]}.`;

type ExtractCandidate = {
  content?: string;
  summary?: string;
  kind?: "semantic" | "episodic";
  scope?: "participant" | "social" | "general";
  importance?: number;
  confidence?: number;
  occurredAt?: string;
  involvedKeys?: string[];
  aboutSpeaker?: boolean;
  evolvesPrior?: boolean;
};

type ExtractResponse = {
  candidates?: ExtractCandidate[];
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
    if (input.userMessage.trim().length < this.config.minUserMessageLength) return;

    const provider = await this.llm.createActiveProvider();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    const speakerLine = input.speaker
      ? `Speaker: ${input.speaker.displayName} (${input.speaker.key})\n`
      : "Speaker: (unknown — only extract general or clearly multi-party social memories)\n";

    try {
      const result = await provider.complete({
        messages: [
          { role: "system", content: EXTRACTOR_SYSTEM },
          {
            role: "user",
            content: `${speakerLine}User message:\n${input.userMessage}\n\nAssistant reply:\n${input.assistantReply}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 900,
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

        const scope = raw.scope ?? (raw.aboutSpeaker !== false && input.speaker ? "participant" : "general");
        if (scope === "participant" && !input.speaker) continue;

        const subject =
          scope === "participant" && input.speaker && raw.aboutSpeaker !== false ? input.speaker : undefined;

        let involved: ParticipantRef[] | undefined;
        if (scope === "social") {
          const keys = new Set(raw.involvedKeys ?? []);
          if (input.speaker) keys.add(input.speaker.key);
          involved = [...keys].map((key) => ({
            key,
            displayName: key === input.speaker?.key ? input.speaker.displayName : key,
            kind: "user" as const,
          }));
        }

        let supersedesMemoryId: string | undefined;
        if (scope === "participant" && subject && raw.evolvesPrior) {
          supersedesMemoryId = await this.findSupersedesCandidate(input.personaId, subject.key, raw.summary ?? content);
        }

        const response = await this.memory.propose({
          personaId: input.personaId,
          kind: raw.kind === "episodic" ? "episodic" : "semantic",
          scope,
          content,
          summary: raw.summary?.slice(0, 500) ?? content.slice(0, 120),
          confidence,
          importance: clamp01(raw.importance ?? 0.5),
          occurredAt: raw.occurredAt,
          subject,
          involved,
          supersedesMemoryId,
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

  private async findSupersedesCandidate(
    personaId: string,
    subjectKey: string,
    query: string,
  ): Promise<string | undefined> {
    try {
      const result = (await this.memory.search({
        personaId,
        subjectKey,
        query: query.slice(0, 200),
        lifecycleState: "active",
        limit: 5,
      })) as { items?: { id: string }[] };
      return result.items?.[0]?.id;
    } catch {
      return undefined;
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
