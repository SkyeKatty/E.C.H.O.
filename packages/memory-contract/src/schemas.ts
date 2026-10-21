import { z } from "zod";

export const personaScopeSchema = z.object({
  personaId: z.string().uuid(),
});

/** Stable id per human (e.g. discord:guild:userId, twitch:channel:login, dashboard:uuid). */
export const participantSchema = z.object({
  key: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256),
  kind: z.enum(["user", "operator", "moderator", "bot"]).default("user"),
});

export type ParticipantRef = z.infer<typeof participantSchema>;

export const conversationAppendSchema = personaScopeSchema.extend({
  sessionId: z.string().uuid(),
  channel: z.string().default("dashboard"),
  /** Speaker for this batch (applied to user-role messages without their own participant). */
  speaker: participantSchema.optional(),
  messages: z
    .array(
      z.object({
        idempotencyKey: z.string().min(1).max(128),
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string().nullable(),
        createdAt: z.string().datetime().optional(),
        participant: participantSchema.optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const conversationListSchema = personaScopeSchema.extend({
  sessionId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
  beforeSequence: z.number().int().positive().optional(),
});

export const contextRetrieveSchema = personaScopeSchema.extend({
  sessionId: z.string().uuid().optional(),
  /** When set, prefer memories about this speaker (Discord/Twitch/dashboard user). */
  speaker: participantSchema.optional(),
  query: z.string().min(1).max(16_000),
  tokenBudget: z.number().int().min(100).max(32_000).default(2_048),
  maxItems: z.number().int().min(1).max(50).default(12),
});

export const memorySearchSchema = personaScopeSchema.extend({
  query: z.string().max(500).optional(),
  kind: z.enum(["semantic", "episodic", "procedural"]).optional(),
  lifecycleState: z.enum(["candidate", "active", "superseded", "deleted"]).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

export const memoryGetSchema = personaScopeSchema.extend({
  memoryId: z.string().uuid(),
});

export const memoryProposeSchema = personaScopeSchema.extend({
  kind: z.enum(["semantic", "episodic"]).default("semantic"),
  content: z.string().min(1).max(32_000),
  summary: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  importance: z.number().min(0).max(1).default(0.5),
  /** Who this memory is about (usually the user who spoke). Required for auto-promotion. */
  subject: participantSchema.optional(),
  source: z.object({
    type: z.enum(["conversation", "episode", "operator", "consolidation"]),
    sourceId: z.string().uuid().optional(),
    excerpt: z.string().max(2000).optional(),
  }),
  relatedMemoryIds: z.array(z.string().uuid()).optional(),
  contradictionOfMemoryId: z.string().uuid().optional(),
});

export const memoryUpdateSchema = personaScopeSchema.extend({
  memoryId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  content: z.string().min(1).max(32_000).optional(),
  summary: z.string().max(500).optional(),
  lifecycleState: z.enum(["candidate", "active", "superseded"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const memoryDeleteSchema = personaScopeSchema.extend({
  memoryId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

export const episodeRecordSchema = personaScopeSchema.extend({
  sessionId: z.string().uuid(),
  summary: z.string().min(1).max(4000),
  importance: z.number().min(0).max(1).default(0.5),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

export type ContextRetrieveResult = {
  blocks: {
    type: "conversation" | "episode" | "memory";
    id: string;
    text: string;
    estimatedTokens: number;
    sources: { type: string; id: string }[];
  }[];
  injectedText: string;
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
  semanticAvailable: boolean;
  ranking: { fts: boolean; vector: boolean; structured: boolean };
};
