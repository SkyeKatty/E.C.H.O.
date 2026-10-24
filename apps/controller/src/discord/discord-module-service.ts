import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
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
  ): Promise<unknown> {
    if (!this.isAvailable()) {
      throw new Error("Discord module is not connected");
    }
    const result = await this.gateway.invokeCapability(capabilityId, params, {
      timeoutMs,
      moduleId: this.getModuleId() ?? undefined,
    });
    return result;
  }

  async getStatus(): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.CONFIG_STATUS, {});
  }

  async sendMessage(params: {
    channelId: string;
    content: string;
    replyToMessageId?: string;
  }): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.MESSAGE_SEND, params);
  }

  async resolveMember(params: {
    guildId?: string;
    userId?: string;
    query?: string;
  }): Promise<{ matches: { userId: string; username: string; displayName: string; mention: string }[] }> {
    return this.invoke(DISCORD_CAPABILITIES.MEMBER_RESOLVE, params);
  }

  async speakInVoice(params: {
    guildId: string;
    channelId: string;
    text: string;
    audioBase64?: string;
    mimeType?: string;
  }): Promise<unknown> {
    return this.invokeWithTimeout(DISCORD_CAPABILITIES.VOICE_SPEAK, params, 200_000);
  }

  async awaitVoiceSilence(params: {
    guildId: string;
    channelId: string;
    minSilentMs?: number;
    maxWaitMs?: number;
  }): Promise<{ ok: boolean; timedOut?: boolean }> {
    return this.invokeWithTimeout(
      DISCORD_CAPABILITIES.VOICE_AWAIT_SILENCE,
      params,
      (params.maxWaitMs ?? 120_000) + 15_000,
    ) as Promise<{ ok: boolean; timedOut?: boolean }>;
  }

  async cancelVoiceSpeak(params: { guildId: string; channelId: string }): Promise<unknown> {
    return this.invoke(DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL, params);
  }
}
