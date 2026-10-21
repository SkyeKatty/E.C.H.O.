import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { discordRuntimeConfigSchema, type DiscordRuntimeConfig } from "@echo/discord-contract";

const DEFAULT: DiscordRuntimeConfig = discordRuntimeConfigSchema.parse({});

export class DiscordSettingsStore {
  private readonly path: string;

  constructor(dataRoot?: string) {
    this.path = resolve(dataRoot ?? resolve(process.cwd(), "data"), "discord", "settings.json");
  }

  load(): DiscordRuntimeConfig {
    if (!existsSync(this.path)) return { ...DEFAULT };
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      return discordRuntimeConfigSchema.parse(raw);
    } catch {
      return { ...DEFAULT };
    }
  }

  save(patch: Partial<DiscordRuntimeConfig>): DiscordRuntimeConfig {
    const current = this.load();
    const merged = discordRuntimeConfigSchema.parse({ ...current, ...patch });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  }

  /** API-safe view (no bot token). */
  redact(config: DiscordRuntimeConfig) {
    const { botToken: _t, ...rest } = config;
    return {
      ...rest,
      botTokenConfigured: Boolean(config.botToken && config.botToken.length > 8),
    };
  }
}
