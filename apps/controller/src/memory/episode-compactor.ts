import type { LlmBackend } from "../llm/llm-backend.js";
import type { EventLog } from "../persona/state.js";
import type { MemoryModuleService } from "./memory-module-service.js";
import type { ConversationCompactionState } from "@echo/memory-contract";

export type EpisodeCompactorConfig = {
  enabled: boolean;
  /** Messages kept verbatim in the LLM prompt (recent tail). */
  hotWindowMessages: number;
  /** Minimum backlog beyond the hot window before compacting. */
  minMessagesPerEpisode: number;
  /** Max messages summarized into one episode chunk. */
  maxMessagesPerEpisode: number;
  requestTimeoutMs: number;
};

const SUMMARIZER_SYSTEM = `You compress chat logs into episodic memory for a persona.
An episode is one continuous chunk of conversation the persona may recall later — not a full day or stream.

Write a dense third-person summary the persona can use as memory:
- Who participated (names/roles if known)
- Topics, decisions, jokes, conflicts, plans
- Emotional tone and relationship shifts
- Open threads or promises

Return ONLY plain text (no JSON). 2–8 sentences. Past tense unless ongoing.`;

export class EpisodeCompactor {
  constructor(
    private readonly llm: LlmBackend,
    private readonly memory: MemoryModuleService,
    private readonly eventLog: EventLog,
    private readonly config: EpisodeCompactorConfig,
  ) {}

  /** Fire-and-forget rolling compaction after messages are persisted. */
  afterTurn(input: { personaId: string; sessionId: string; turnId: string }): void {
    if (!this.config.enabled) return;
    void this.runCompaction(input).catch((err) => {
      this.eventLog.append({
        type: "memory.warn",
        summary: `Episode compaction failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    });
  }

  private async runCompaction(input: {
    personaId: string;
    sessionId: string;
    turnId: string;
  }): Promise<void> {
    if (!this.memory.isAvailable() || !this.llm.isAvailable()) return;

    const state = await this.memory.getCompactionState({
      personaId: input.personaId,
      sessionId: input.sessionId,
    });

    const range = this.planRange(state);
    if (!range) return;

    const listed = await this.memory.listConversation({
      personaId: input.personaId,
      sessionId: input.sessionId,
      fromSequence: range.fromSequence,
      toSequence: range.toSequence,
      limit: this.config.maxMessagesPerEpisode,
    });

    if (listed.messages.length < this.config.minMessagesPerEpisode) return;

    const transcript = listed.messages
      .map((m) => {
        const who = m.speakerDisplayName ? `[${m.speakerDisplayName}] ` : "";
        return `${who}${m.role}: ${m.content ?? ""}`.trim();
      })
      .join("\n");

    const provider = await this.llm.createProviderForTask("episode_summary");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const result = await provider.complete({
        messages: [
          { role: "system", content: SUMMARIZER_SYSTEM },
          {
            role: "user",
            content: `Channel context: ${state.channel ?? "unknown"}\nSequence ${range.fromSequence}–${range.toSequence}\n\n${transcript}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 700,
        signal: controller.signal,
      });

      const summary = (result.message.content ?? "").trim();
      if (summary.length < 40) return;

      const startedAt = listed.messages[0]?.createdAt;
      const endedAt = listed.messages[listed.messages.length - 1]?.createdAt;
      const idempotencyKey = `compact:${input.sessionId}:${range.fromSequence}-${range.toSequence}`;

      const recorded = await this.memory.recordEpisode({
        personaId: input.personaId,
        sessionId: input.sessionId,
        summary,
        importance: 0.55,
        fromSequence: range.fromSequence,
        toSequence: range.toSequence,
        startedAt,
        endedAt,
        idempotencyKey,
      });

      const dup = (recorded as { duplicate?: boolean }).duplicate;
      if (!dup) {
        this.eventLog.append({
          type: "memory.episode",
          summary: `Compacted messages ${range.fromSequence}–${range.toSequence} into episode (${summary.slice(0, 64)}…)`,
        });
      }

      // Drain backlog in one turn if multiple batches are waiting.
      if (!dup && this.planRange({ ...state, compactedThroughSequence: range.toSequence })) {
        this.afterTurn(input);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private planRange(state: ConversationCompactionState): { fromSequence: number; toSequence: number } | null {
    const hot = this.config.hotWindowMessages;
    const minBatch = this.config.minMessagesPerEpisode;
    const maxBatch = this.config.maxMessagesPerEpisode;

    const backlog = state.maxSequence - state.compactedThroughSequence;
    if (backlog <= hot + minBatch) return null;

    const fromSequence = state.compactedThroughSequence + 1;
    const upper = state.maxSequence - hot;
    const toSequence = Math.min(fromSequence + maxBatch - 1, upper);
    if (toSequence < fromSequence) return null;
    if (toSequence - fromSequence + 1 < minBatch) return null;

    return { fromSequence, toSequence };
  }
}
