import { z } from "zod";

export const timeNowSchema = z.object({
  timezone: z.string().min(1).optional(),
});

export const timeDateSchema = z.object({
  timezone: z.string().min(1).optional(),
});

export const timeTimerCreateSchema = z
  .object({
    description: z.string().min(1).max(2000),
    delaySeconds: z.number().int().min(1).max(86_400).optional(),
    delayMinutes: z.number().int().min(1).max(1_440).optional(),
    /** Filled by controller when omitted (chat session that set the timer). */
    sessionId: z.string().uuid().optional(),
    personaId: z.string().uuid().optional(),
    notifyDiscord: z
      .object({
        channelId: z.string().min(1),
        guildId: z.string().min(1).optional(),
      })
      .optional(),
    /** Discord user ids to @mention when the timer fires (use discord_member_resolve to find ids). */
    mentionUserIds: z.array(z.string().min(1)).max(10).optional(),
    /** Resolved by controller into mentionUserIds when Discord is available. */
    mentionUsernames: z.array(z.string().min(1).max(64)).max(10).optional(),
  })
  .refine((d) => d.delaySeconds !== undefined || d.delayMinutes !== undefined, {
    message: "Provide delaySeconds or delayMinutes",
  });

export const timeTimerCancelSchema = z.object({
  timerId: z.string().uuid(),
});

export const timeTimerFiredSchema = z.object({
  timerId: z.string().uuid(),
  description: z.string(),
  sessionId: z.string().uuid(),
  personaId: z.string().uuid().optional(),
  firedAt: z.string().datetime(),
  notifyDiscord: z
    .object({
      channelId: z.string().min(1),
      guildId: z.string().min(1).optional(),
    })
    .optional(),
  mentionUserIds: z.array(z.string().min(1)).max(10).optional(),
});
