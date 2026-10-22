import { DISCORD_CAPABILITIES, type DiscordChannelsList } from "@echo/discord-contract";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { ModuleGateway } from "../ws/module-gateway.js";

export class DiscordModuleService {
  /** Login + gateway connect can exceed default module RPC timeout. */
  private readonly configApplyTimeoutMs: number;

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly gateway: ModuleGateway,
    private readonly timeoutMs: number,
    configApplyTimeoutMs = 20_000,
  ) {
    this.configApplyTimeoutMs = configApplyTimeoutMs;
  }

  isAvailable(): boolean {
    return this.registry.listModulesWithCapability(DISCORD_CAPABILITIES.HEALTH_GET).length > 0;
  }

  getModuleId(): string | null {
    const mods = this.registry.listModulesWithCapability(DISCORD_CAPABILITIES.HEALTH_GET);
    return mods[0]?.moduleId ?? null;
  }

  async invoke<T>(capabilityId: string, params: unknown): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error("Discord module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs: this.timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
    });
    return result as T;
  }

  async applyConfig(config: unknown): Promise<unknown> {
    return this.invokeWithTimeout(
      DISCORD_CAPABILITIES.CONFIG_APPLY,
      config,
      this.configApplyTimeoutMs,
    );
  }

  private async invokeWithTimeout(
    capabilityId: string,
    params: unknown,
    timeoutMs: number,
    revocable = true,
  ): Promise<unknown> {
    if (!this.isAvailable()) {
      throw new Error("Discord module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
      revocable,
      timeoutGraceMs: revocable ? undefined : 45_000,
    });
    return result;
  }

  /** Tool / side-effect calls: never cancelled by chat abort; long timeout + grace. */
  async invokeSideEffect<T>(capabilityId: string, params: unknown): Promise<T> {
    const timeoutMs = Math.max(this.timeoutMs, 120_000);
    return (await this.invokeWithTimeout(capabilityId, params, timeoutMs, false)) as T;
  }

  async getStatus(): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.CONFIG_STATUS, {});
  }

  async listChannels(): Promise<DiscordChannelsList> {
    return this.invokeSideEffect<DiscordChannelsList>(DISCORD_CAPABILITIES.CHANNELS_LIST, {});
  }

  async sendMessage(params: {
    channelId: string;
    content: string;
    replyToMessageId?: string;
  }): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.MESSAGE_SEND, params);
  }

  async speakInVoice(params: {
    guildId: string;
    channelId: string;
    text: string;
    audioBase64?: string;
    mimeType?: string;
  }): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.VOICE_SPEAK, params);
  }

  async cancelVoiceSpeak(params: { guildId: string; channelId: string }): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL, params);
  }
}
