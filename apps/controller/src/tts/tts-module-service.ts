import { TTS_CAPABILITIES } from "@echo/voice-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";

export class TtsModuleService {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly gateway: ModuleGateway,
    private readonly timeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return this.registry.listModulesWithCapability(TTS_CAPABILITIES.HEALTH_GET).length > 0;
  }

  getModuleId(): string | null {
    return this.registry.listModulesWithCapability(TTS_CAPABILITIES.HEALTH_GET)[0]?.moduleId ?? null;
  }

  async invoke<T>(capabilityId: string, params: unknown): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error("TTS module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs: this.timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
    });
    return result as T;
  }

  async getStatus(): Promise<unknown> {
    return this.invoke(TTS_CAPABILITIES.CONFIG_STATUS, {});
  }

  async enqueueSpeech(params: {
    streamId: string;
    sequence: number;
    text: string;
    sink?: string;
    flush?: boolean;
  }): Promise<unknown> {
    return this.invoke(TTS_CAPABILITIES.SPEECH_ENQUEUE, params);
  }

  async flushSpeech(params: {
    streamId: string;
    tailText?: string;
    sink?: string;
  }): Promise<unknown> {
    return this.invoke(TTS_CAPABILITIES.SPEECH_FLUSH, params);
  }

  async applyConfig(config: unknown): Promise<unknown> {
    return this.invoke(TTS_CAPABILITIES.CONFIG_APPLY, config);
  }
}
