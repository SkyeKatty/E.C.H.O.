import {
  ModelOverrideProvider,
  providerCategory,
  resolveTaskBinding,
  type LLMProvider,
  type LlmTask,
  type ProviderProfile,
} from "@echo/llm";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";
import { LLM_SETTINGS_GET, LLM_SETTINGS_UPDATE } from "./constants.js";
import type { LlmBackend, LlmSettingsResponse } from "./llm-backend.js";
import { ModuleLlmProvider } from "./module-llm-provider.js";

export class LlmModuleService implements LlmBackend {
  readonly adapter = "module" as const;
  private readonly moduleProviders = new Map<string, ModuleLlmProvider>();
  private readonly taskProviders = new Map<LlmTask, LLMProvider>();

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
    this.clearProviderCache();
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

  createActiveProvider(): Promise<LLMProvider> {
    return this.createProviderForTask("chat");
  }

  async createProviderForTask(task: LlmTask): Promise<LLMProvider> {
    if (!this.isAvailable()) {
      throw new Error("LLM module not connected");
    }

    const cached = this.taskProviders.get(task);
    if (cached) return cached;

    const { settings } = await this.getSettings();
    const binding = resolveTaskBinding(settings, task);
    const base = this.getOrCreateModuleProvider(binding.profile);
    const provider =
      binding.model === binding.profile.model
        ? base
        : new ModelOverrideProvider(base, binding.model);
    this.taskProviders.set(task, provider);
    return provider;
  }

  private getOrCreateModuleProvider(profile: ProviderProfile): ModuleLlmProvider {
    let provider = this.moduleProviders.get(profile.id);
    if (provider) return provider;

    provider = new ModuleLlmProvider(
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
    this.moduleProviders.set(profile.id, provider);
    return provider;
  }

  private clearProviderCache(): void {
    this.moduleProviders.clear();
    this.taskProviders.clear();
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new Error("LLM module is not connected");
    }
  }
}
