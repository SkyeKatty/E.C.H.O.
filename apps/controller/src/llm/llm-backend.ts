import type { LLMProvider, LlmRuntimeSettings, LlmTask } from "@echo/llm";

export type LlmSettingsResponse = {
  settings: LlmRuntimeSettings;
  loadErrors: string[];
};

export interface LlmBackend {
  readonly adapter: "module" | "embedded";
  isAvailable(): boolean;
  getModuleId(): string | null;
  getSettings(): Promise<LlmSettingsResponse>;
  updateSettings(params: {
    activeProviderId?: string;
    providers?: LlmRuntimeSettings["providers"];
    tasks?: LlmRuntimeSettings["tasks"];
    profile?: {
      id: string;
      model?: string;
      baseUrl?: string;
      enabled?: boolean;
      label?: string;
      generation?: { temperature?: number; maxTokens?: number };
    };
  }): Promise<LlmSettingsResponse>;
  listProviders(): Promise<
    {
      id: string;
      label: string;
      model: string;
      kind: string;
      category: string;
      generation: { temperature: number; maxTokens: number };
      capabilities: { toolCalling: boolean; streaming: boolean; vision: boolean };
    }[]
  >;
  getActiveProviderId(): Promise<string>;
  /** @deprecated Use createProviderForTask("chat"). */
  createActiveProvider(): Promise<LLMProvider>;
  createProviderForTask(task: LlmTask): Promise<LLMProvider>;
}
