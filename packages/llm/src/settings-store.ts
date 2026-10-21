import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findMonorepoRoot } from "./env-file.js";
import {
  defaultRuntimeSettings,
  llmRuntimeSettingsSchema,
  type LlmRuntimeSettings,
} from "./settings.js";

export class LlmSettingsStore {
  constructor(private readonly filePath: string) {}

  static defaultFilePath(): string {
    if (process.env.ECHO_LLM_SETTINGS_PATH) {
      return resolve(process.env.ECHO_LLM_SETTINGS_PATH);
    }
    const root = findMonorepoRoot(process.cwd());
    const dir = process.env.ECHO_DATA_DIR ?? resolve(root, "data");
    return resolve(dir, "llm-settings.json");
  }

  load(): LlmRuntimeSettings {
    if (!existsSync(this.filePath)) {
      const defaults = defaultRuntimeSettings();
      this.save(defaults);
      return defaults;
    }
    const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    return llmRuntimeSettingsSchema.parse(raw);
  }

  save(settings: LlmRuntimeSettings): LlmRuntimeSettings {
    const parsed = llmRuntimeSettingsSchema.parse(settings);
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }
}
