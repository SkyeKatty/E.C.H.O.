import { z } from "zod";

export const transferEntitySchema = z.enum([
  "personas",
  "participants",
  "memories",
  "memory_provenance",
  "memory_relations",
  "memory_involvements",
  "episodes",
  "embeddings",
  "conversations",
  "messages",
]);

export type TransferEntity = z.infer<typeof transferEntitySchema>;

export const transferExportChunkSchema = z.object({
  entity: transferEntitySchema,
  personaIds: z.array(z.string().uuid()).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(100),
});

export const transferImportChunkSchema = z.object({
  entity: transferEntitySchema,
  mode: z.enum(["merge", "skip_existing"]).default("merge"),
  records: z.array(z.record(z.unknown())).max(500),
});

export type TransferExportChunkResult = {
  entity: TransferEntity;
  offset: number;
  limit: number;
  count: number;
  hasMore: boolean;
  records: Record<string, unknown>[];
};

export type TransferImportChunkResult = {
  entity: TransferEntity;
  inserted: number;
  updated: number;
  skipped: number;
};
