import {
  MEMORY_CAPABILITIES,
  type ContextRetrieveResult,
  type ParticipantRef,
  conversationAppendSchema,
  conversationListSchema,
  contextRetrieveSchema,
  memoryDeleteSchema,
  memoryGetSchema,
  memoryProposeSchema,
  memorySearchSchema,
  memoryUpdateSchema,
} from "@echo/memory-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";
import { MEMORY_CONTEXT_RETRIEVE, MEMORY_CONVERSATION_APPEND, MEMORY_CONVERSATION_LIST, MEMORY_HEALTH_GET } from "./constants.js";

export class MemoryModuleService {
  constructor(
    private readonly moduleRegistry: ModuleRegistry,
    private readonly moduleGateway: ModuleGateway,
    private readonly requestTimeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.moduleRegistry.findCapabilityOwner(MEMORY_HEALTH_GET));
  }

  getModuleId(): string | null {
    return this.moduleRegistry.findCapabilityOwner(MEMORY_HEALTH_GET)?.moduleId ?? null;
  }

  private async invoke<T>(capabilityId: string, params: unknown): Promise<T> {
    this.assertAvailable();
    const result = await this.moduleGateway.invokeCapability(capabilityId, params, {
      timeoutMs: this.requestTimeoutMs,
    });
    return result as T;
  }

  async getHealth(): Promise<{ status: string; database: boolean; semanticAvailable: boolean }> {
    return this.invoke(MEMORY_HEALTH_GET, {});
  }

  async appendConversation(params: {
    personaId: string;
    sessionId: string;
    channel?: string;
    speaker?: ParticipantRef;
    messages: { idempotencyKey: string; role: string; content: string | null; createdAt?: string }[];
  }): Promise<{ conversationId: string; inserted: number }> {
    const body = conversationAppendSchema.parse({
      personaId: params.personaId,
      sessionId: params.sessionId,
      channel: params.channel ?? "dashboard",
      speaker: params.speaker,
      messages: params.messages,
    });
    return this.invoke(MEMORY_CONVERSATION_APPEND, body);
  }

  async listConversation(params: {
    personaId: string;
    sessionId: string;
    limit?: number;
  }): Promise<{
    messages: { id: string; role: string; content: string | null; sequence: number; createdAt: string }[];
    hasMore: boolean;
  }> {
    const body = conversationListSchema.parse(params);
    return this.invoke(MEMORY_CONVERSATION_LIST, body);
  }

  async retrieveContext(params: {
    personaId: string;
    sessionId?: string;
    speaker?: ParticipantRef;
    query: string;
    tokenBudget?: number;
  }): Promise<ContextRetrieveResult> {
    const body = contextRetrieveSchema.parse(params);
    return this.invoke(MEMORY_CONTEXT_RETRIEVE, body);
  }

  async search(params: unknown) {
    return this.invoke(MEMORY_CAPABILITIES.SEARCH, memorySearchSchema.parse(params));
  }

  async get(params: unknown) {
    return this.invoke(MEMORY_CAPABILITIES.GET, memoryGetSchema.parse(params));
  }

  async propose(params: unknown) {
    return this.invoke(MEMORY_CAPABILITIES.PROPOSE, memoryProposeSchema.parse(params));
  }

  async update(params: unknown) {
    return this.invoke(MEMORY_CAPABILITIES.UPDATE, memoryUpdateSchema.parse(params));
  }

  async delete(params: unknown) {
    return this.invoke(MEMORY_CAPABILITIES.DELETE, memoryDeleteSchema.parse(params));
  }

  async listJobs() {
    return this.invoke<{ jobs: unknown[] }>(MEMORY_CAPABILITIES.JOB_LIST, {});
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error("Memory module is not connected. Start it with: pnpm dev:memory");
    }
  }
}
