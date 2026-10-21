import {
  MEMORY_CAPABILITIES,
  type TransferEntity,
  type TransferExportChunkResult,
  type TransferImportChunkResult,
  transferExportChunkSchema,
  transferImportChunkSchema,
} from "@echo/memory-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";
import { MEMORY_HEALTH_GET } from "./constants.js";

const TRANSFER_ENTITIES: TransferEntity[] = [
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
];

export type MemoryTransferRequest = {
  sourceModuleId: string;
  targetModuleId: string;
  personaIds?: string[];
  includeConversations?: boolean;
  mode?: "merge" | "skip_existing";
  batchSize?: number;
  dryRun?: boolean;
};

export type MemoryTransferResult = {
  dryRun: boolean;
  sourceModuleId: string;
  targetModuleId: string;
  entities: Record<
    string,
    { exported: number; inserted: number; updated: number; skipped: number; batches: number }
  >;
};

export class MemoryTransferService {
  constructor(
    private readonly moduleRegistry: ModuleRegistry,
    private readonly moduleGateway: ModuleGateway,
    private readonly requestTimeoutMs: number,
  ) {}

  listMemoryModules() {
    return this.moduleRegistry.listModulesWithCapability(MEMORY_HEALTH_GET).map((m) => ({
      moduleId: m.moduleId,
      name: m.name,
      version: m.version,
      host: m.host,
      metadata: m.metadata,
      connectionState: m.connectionState,
    }));
  }

  async transfer(input: MemoryTransferRequest): Promise<MemoryTransferResult> {
    const source = this.moduleRegistry.findModuleById(input.sourceModuleId);
    const target = this.moduleRegistry.findModuleById(input.targetModuleId);
    if (!source) throw new Error(`Source module not connected: ${input.sourceModuleId}`);
    if (!target) throw new Error(`Target module not connected: ${input.targetModuleId}`);
    if (source.moduleId === target.moduleId) {
      throw new Error("Source and target module must be different");
    }

    const batchSize = input.batchSize ?? 100;
    const mode = input.mode ?? "merge";
    const entities = input.includeConversations
      ? TRANSFER_ENTITIES
      : TRANSFER_ENTITIES.filter((e) => e !== "conversations" && e !== "messages");

    const result: MemoryTransferResult = {
      dryRun: Boolean(input.dryRun),
      sourceModuleId: source.moduleId,
      targetModuleId: target.moduleId,
      entities: {},
    };

    const timeoutMs = Math.max(this.requestTimeoutMs, 120_000);

    for (const entity of entities) {
      let offset = 0;
      let hasMore = true;
      let exported = 0;
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let batches = 0;

      while (hasMore) {
        const chunk = (await this.moduleGateway.invokeCapability(
          MEMORY_CAPABILITIES.TRANSFER_EXPORT_CHUNK,
          transferExportChunkSchema.parse({
            entity,
            personaIds: input.personaIds,
            offset,
            limit: batchSize,
          }),
          { timeoutMs, moduleId: source.moduleId },
        )) as TransferExportChunkResult;

        exported += chunk.count;
        batches += 1;
        hasMore = chunk.hasMore;
        offset += chunk.count;

        if (input.dryRun || chunk.count === 0) {
          continue;
        }

        const imported = (await this.moduleGateway.invokeCapability(
          MEMORY_CAPABILITIES.TRANSFER_IMPORT_CHUNK,
          transferImportChunkSchema.parse({
            entity,
            mode,
            records: chunk.records,
          }),
          { timeoutMs, moduleId: target.moduleId },
        )) as TransferImportChunkResult;

        inserted += imported.inserted;
        updated += imported.updated;
        skipped += imported.skipped;
      }

      result.entities[entity] = { exported, inserted, updated, skipped, batches };
    }

    return result;
  }
}
