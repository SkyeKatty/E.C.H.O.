import { LlmSettingsStore } from "./settings-store.js";
import { ProviderRegistry } from "./registry.js";
import { llmRuntimeSettingsSchema, settingsToProviderConfigs, type LlmRuntimeSettings } from "./settings.js";
import type { CompletionRequest } from "./types.js";

/** In-process LLM runtime (shared by the LLM module and embedded controller adapter). */
export class LlmRuntime {
  private readonly store: LlmSettingsStore;
  private registry: ProviderRegistry;
  private settings: LlmRuntimeSettings;

  constructor(settingsPath?: string) {
    this.store = new LlmSettingsStore(settingsPath ?? LlmSettingsStore.defaultFilePath());
    this.settings = this.store.load();
    this.registry = ProviderRegistry.fromRuntimeSettings(this.settings);
    const errors = this.registry.getLoadErrors();
    if (errors.length) {
      console.warn("[llm] Provider load warnings at startup:", errors.join("; "));
    }
  }

  getSettings(): LlmRuntimeSettings {
    return structuredClone(this.settings);
  }

  getLoadErrors(): string[] {
    return this.registry.getLoadErrors();
  }

  updateSettings(partial: Partial<LlmRuntimeSettings>): LlmRuntimeSettings {
    const merged = llmRuntimeSettingsSchema.parse({ ...this.settings, ...partial });
    this.registry.reload(settingsToProviderConfigs(merged), merged.activeProviderId);

    const errors = this.registry.getLoadErrors();
    const activeId = this.registry.getActiveId();
    if (merged.activeProviderId !== activeId) {
      throw new Error(
        `Cannot use provider "${merged.activeProviderId}"${errors.length ? `: ${errors.join("; ")}` : ""}`,
      );
    }
    if (errors.length) {
      console.warn("[llm] Provider load warnings:", errors.join("; "));
    }

    merged.activeProviderId = activeId;
    this.settings = this.store.save(merged);
    return this.getSettings();
  }

  getActiveProvider() {
    return this.registry.getActive();
  }

  async complete(request: CompletionRequest) {
    return this.registry.getActive().complete(request);
  }

  async *stream(request: CompletionRequest) {
    yield* this.registry.getActive().stream(request);
  }
}
