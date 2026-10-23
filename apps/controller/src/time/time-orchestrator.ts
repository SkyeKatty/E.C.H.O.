import type { z } from "zod";
import type { timeTimerFiredSchema } from "@echo/time-contract";
import type { CognitiveEngine } from "../cognition/engine.js";
import { getDiscordDeliveryForSession } from "../discord/session-delivery.js";
import type { DiscordModuleService } from "../discord/discord-module-service.js";
import type { EventLog } from "../persona/state.js";

type TimerFiredPayload = z.infer<typeof timeTimerFiredSchema>;

export class TimeOrchestrator {
  constructor(
    private readonly engine: CognitiveEngine,
    private readonly discord: DiscordModuleService,
    private readonly eventLog: EventLog,
  ) {}

  async handleTimerFired(payload: TimerFiredPayload): Promise<void> {
    if (!this.engine.isChatAvailable()) {
      this.eventLog.append({
        type: "time.error",
        summary: `Timer fired but LLM unavailable: ${payload.description.slice(0, 60)}`,
      });
      return;
    }

    this.eventLog.append({
      type: "time.timer",
      summary: `Timer fired: ${payload.description.slice(0, 120)}`,
    });

    const prompt = `[Timer finished] The timer you set is due.\n\nPurpose when you set it: ${payload.description}\n\nSpeak to the user in character — deliver what you intended when you scheduled this timer. Keep it concise unless the moment calls for more.`;

    try {
      const result = await this.engine.chat({
        message: prompt,
        sessionId: payload.sessionId,
        stream: false,
      });

      const discordTarget =
        payload.notifyDiscord ?? getDiscordDeliveryForSession(payload.sessionId);
      if (discordTarget?.channelId && this.discord.isAvailable()) {
        const pings =
          payload.mentionUserIds?.map((id) => `<@${id}>`).join(" ").trim() ?? "";
        const body = pings ? `${pings} ${result.reply}` : result.reply;
        await this.discord.sendMessage({
          channelId: discordTarget.channelId,
          content: body.slice(0, 2000),
        });
        this.eventLog.append({
          type: "time.outbound",
          summary: `Timer reply sent to Discord #${discordTarget.channelId}`,
        });
      } else if (!discordTarget?.channelId) {
        this.eventLog.append({
          type: "time.warn",
          summary: "Timer reply generated but no Discord channel was linked to this session",
        });
      }

      this.eventLog.append({
        type: "time.reply",
        summary: `Timer generation complete (${result.reply.length} chars)`,
      });
    } catch (err) {
      this.eventLog.append({
        type: "time.error",
        summary: `Timer generation failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }
}
