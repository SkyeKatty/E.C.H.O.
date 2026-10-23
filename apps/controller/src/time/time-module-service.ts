import { TIME_CAPABILITIES } from "@echo/time-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";

export class TimeModuleService {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly gateway: ModuleGateway,
    private readonly timeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return this.registry.listModulesWithCapability(TIME_CAPABILITIES.HEALTH_GET).length > 0;
  }

  getModuleId(): string | null {
    return this.registry.listModulesWithCapability(TIME_CAPABILITIES.HEALTH_GET)[0]?.moduleId ?? null;
  }

  async getHealth(): Promise<unknown> {
    return this.invoke(TIME_CAPABILITIES.HEALTH_GET, {});
  }

  private async invoke<T>(capabilityId: string, params: unknown): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error("Timekeeping module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs: this.timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
    });
    return result as T;
  }
}
