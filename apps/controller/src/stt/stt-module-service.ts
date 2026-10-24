import { STT_CAPABILITIES } from "@echo/voice-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";

export class SttModuleService {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly gateway: ModuleGateway,
    private readonly timeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return this.registry.listModulesWithCapability(STT_CAPABILITIES.HEALTH_GET).length > 0;
  }

  getModuleId(): string | null {
    return this.registry.listModulesWithCapability(STT_CAPABILITIES.HEALTH_GET)[0]?.moduleId ?? null;
  }

  async invoke<T>(capabilityId: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error("STT module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs: timeoutMs ?? this.timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
    });
    return result as T;
  }

  async getStatus(): Promise<unknown> {
    return this.invoke(STT_CAPABILITIES.CONFIG_STATUS, {});
  }

  async sessionStart(params: unknown): Promise<unknown> {
    return this.invoke(STT_CAPABILITIES.SESSION_START, params);
  }

  async audioAppend(params: unknown): Promise<unknown> {
    return this.invoke(STT_CAPABILITIES.AUDIO_APPEND, params);
  }

  async sessionEnd(params: unknown): Promise<unknown> {
    return this.invoke(STT_CAPABILITIES.SESSION_END, params, 120_000);
  }

  async applyConfig(config: unknown): Promise<unknown> {
    return this.invoke(STT_CAPABILITIES.CONFIG_APPLY, config);
  }
}
