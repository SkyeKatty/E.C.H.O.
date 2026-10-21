import type { LLMProvider, LLMProviderInfo, ProviderConfig } from "./types.js";
import { createProvider } from "./factory.js";
import {
  type LlmRuntimeSettings,
  settingsToProviderConfigs,
} from "./settings.js";

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private activeId: string;
  private loadErrors: string[] = [];

  static fromRuntimeSettings(settings: LlmRuntimeSettings): ProviderRegistry {
    return new ProviderRegistry(
      settingsToProviderConfigs(settings),
      settings.activeProviderId,
    );
  }

  constructor(configs: ProviderConfig[], defaultProviderId: string) {
    this.loadErrors = [];
    const enabled = configs.filter((c) => c.enabled !== false);
    if (enabled.length === 0) {
      throw new Error("At least one enabled LLM provider must be configured");
    }
    const loadErrors: string[] = [];
    for (const cfg of enabled) {
      try {
        this.providers.set(cfg.id, createProvider(cfg));
      } catch (err) {
        loadErrors.push(`${cfg.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.loadErrors = loadErrors;
    if (loadErrors.length) {
      console.warn("[ProviderRegistry] Some providers failed to load:", loadErrors.join("; "));
    }
    if (this.providers.size === 0) {
      throw new Error(
        `No LLM providers could be loaded${loadErrors.length ? `: ${loadErrors.join("; ")}` : ""}`,
      );
    }
    if (!this.providers.has(defaultProviderId)) {
      const fallback = this.providers.keys().next().value!;
      console.warn(
        `[ProviderRegistry] Default provider "${defaultProviderId}" unavailable; using "${fallback}"`,
      );
      this.activeId = fallback;
    } else {
      this.activeId = defaultProviderId;
    }
  }

  getActive(): LLMProvider {
    const p = this.providers.get(this.activeId);
    if (!p) throw new Error(`Active provider "${this.activeId}" not found`);
    return p;
  }

  getActiveId(): string {
    return this.activeId;
  }

  setActive(id: string): LLMProvider {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown provider id: ${id}`);
    }
    this.activeId = id;
    return this.getActive();
  }

  list(): LLMProviderInfo[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      label: p.label,
      model: p.model,
      capabilities: p.getCapabilities(),
    }));
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getLoadErrors(): string[] {
    return [...this.loadErrors];
  }

  /** Rebuild provider instances from configs (after settings change). */
  reload(configs: ProviderConfig[], activeProviderId: string): void {
    this.providers.clear();
    this.loadErrors = [];
    const enabled = configs.filter((c) => c.enabled !== false);
    for (const cfg of enabled) {
      try {
        this.providers.set(cfg.id, createProvider(cfg));
      } catch (err) {
        this.loadErrors.push(`${cfg.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (this.providers.has(activeProviderId)) {
      this.activeId = activeProviderId;
    } else if (this.providers.size > 0) {
      this.activeId = this.providers.keys().next().value!;
    }
  }
}
