import { providerCategory, type LLMProvider } from "@echo/llm";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";
import { LLM_SETTINGS_GET, LLM_SETTINGS_UPDATE } from "./constants.js";
import type { LlmBackend, LlmSettingsResponse } from "./llm-backend.js";
import { ModuleLlmProvider } from "./module-llm-provider.js";

export class LlmModuleService implements LlmBackend {
  readonly adapter = "module" as const;
  constructor(
    private readonly moduleRegistry: ModuleRegistry,
    private readonly moduleGateway: ModuleGateway,
    private readonly requestTimeoutMs: number,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.moduleRegistry.findCapabilityOwner(LLM_SETTINGS_GET));
  }

  getModuleId(): string | null {
    return this.moduleRegistry.findCapabilityOwner(LLM_SETTINGS_GET)?.moduleId ?? null;
  }

  async getSettings(): Promise<LlmSettingsResponse> {
    this.assertAvailable();
    const result = await this.moduleGateway.invokeCapability(LLM_SETTINGS_GET, {}, {
      timeoutMs: this.requestTimeoutMs,
    });
    return result as LlmSettingsResponse;
  }

  async updateSettings(params: Parameters<LlmBackend["updateSettings"]>[0]): Promise<LlmSettingsResponse> {
    this.assertAvailable();
    const result = await this.moduleGateway.invokeCapability(LLM_SETTINGS_UPDATE, params, {
      timeoutMs: this.requestTimeoutMs,
    });
    return result as LlmSettingsResponse;
  }

  async listProviders(): Promise<Awaited<ReturnType<LlmBackend["listProviders"]>>> {
    const { settings } = await this.getSettings();
    return settings.providers
      .filter((p) => p.enabled)
      .map((p) => ({
        id: p.id,
        label: p.label,
        model: p.model,
        kind: p.kind,
        category: providerCategory(p),
        generation: {
          temperature: p.generation?.temperature ?? 0.7,
          maxTokens: p.generation?.maxTokens ?? 2048,
        },
        capabilities: {
          toolCalling: p.capabilities?.toolCalling ?? p.kind === "openrouter",
          streaming: p.capabilities?.streaming ?? true,
          vision: p.capabilities?.vision ?? false,
        },
      }));
  }

  async getActiveProviderId(): Promise<string> {
    const { settings } = await this.getSettings();
    return settings.activeProviderId;
  }

  async createActiveProvider(): Promise<LLMProvider> {
    const { settings } = await this.getSettings();
    const profile = settings.providers.find((p) => p.id === settings.activeProviderId);
    if (!profile) {
      throw new Error(`Active provider profile "${settings.activeProviderId}" not found`);
    }
    if (!this.isAvailable()) {
      throw new Error("LLM module not connected");
    }

    return new ModuleLlmProvider(
      profile.id,
      profile.label,
      profile.model,
      {
        toolCalling: profile.capabilities?.toolCalling ?? profile.kind === "openrouter",
        streaming: profile.capabilities?.streaming ?? true,
        vision: profile.capabilities?.vision ?? false,
      },
      this.moduleGateway,
      this.requestTimeoutMs,
    );
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error("LLM module is not connected");
    }
  }
}
