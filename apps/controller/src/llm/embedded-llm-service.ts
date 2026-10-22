import {
  LlmRuntime,
  llmRuntimeSettingsSchema,
  ModelOverrideProvider,
  providerCategory,
  resolveTaskBinding,
  type LLMProvider,
  type LlmTask,
} from "@echo/llm";
import type { LlmBackend, LlmSettingsResponse } from "./llm-backend.js";

export class EmbeddedLlmService implements LlmBackend {
  readonly adapter = "embedded" as const;
  private readonly runtime: LlmRuntime;

  constructor(settingsPath?: string) {
    this.runtime = new LlmRuntime(settingsPath);
  }

  isAvailable(): boolean {
    return true;
  }

  getModuleId(): string | null {
    return null;
  }

  async getSettings(): Promise<LlmSettingsResponse> {
    return {
      settings: this.runtime.getSettings(),
      loadErrors: this.runtime.getLoadErrors(),
    };
  }

  async updateSettings(params: Parameters<LlmBackend["updateSettings"]>[0]): Promise<LlmSettingsResponse> {
    let next = this.runtime.getSettings();

    if (params.providers) {
      next = this.runtime.updateSettings({
        providers: llmRuntimeSettingsSchema.shape.providers.parse(params.providers),
      });
    }

    if (params.activeProviderId) {
      next = this.runtime.updateSettings({ activeProviderId: params.activeProviderId });
    }

    if (params.tasks) {
      next = this.runtime.updateSettings({
        tasks: { ...next.tasks, ...params.tasks },
      });
    }

    if (params.profile) {
      const profile = params.profile;
      const providers = next.providers.map((p) =>
        p.id === profile.id
          ? {
              ...p,
              ...(profile.model !== undefined ? { model: profile.model } : {}),
              ...(profile.baseUrl !== undefined ? { baseUrl: profile.baseUrl } : {}),
              ...(profile.enabled !== undefined ? { enabled: profile.enabled } : {}),
              ...(profile.label !== undefined ? { label: profile.label } : {}),
              ...(profile.generation
                ? { generation: { ...p.generation, ...profile.generation } }
                : {}),
            }
          : p,
      );
      next = this.runtime.updateSettings({ providers });
    }

    return {
      settings: next,
      loadErrors: this.runtime.getLoadErrors(),
    };
  }

  async listProviders() {
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
    const settings = this.runtime.getSettings();
    const binding = resolveTaskBinding(settings, task);
    const base = this.runtime.getProvider(binding.providerId);
    if (binding.model === binding.profile.model) return base;
    return new ModelOverrideProvider(base, binding.model);
  }
}
