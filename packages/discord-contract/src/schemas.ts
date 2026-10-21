import { z } from "zod";

export const discordChannelPolicySchema = z.object({
  channelId: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Text channel: listen and optionally reply. */
  textEnabled: z.boolean().default(true),
  /** Voice channel: join for STT/TTS when enabled. */
  voiceEnabled: z.boolean().default(false),
});

export const discordRuntimeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().min(1).optional(),
  applicationId: z.string().optional(),
  /** Guild the bot operates in (single-guild v1). */
  guildId: z.string().min(1).optional(),
  channels: z.array(discordChannelPolicySchema).default([]),
  /** Reserved: optional coalesce delay (orchestrator evaluates each message immediately today). */
  batchWindowMs: z.number().int().min(0).max(60_000).default(0),
  /** Max skipped messages kept while silent; included in the next reply when the persona speaks up. */
  batchMaxMessages: z.number().int().min(1).max(50).default(12),
  /** Always reply when @mentioned or replying to the bot. */
  alwaysRespondToMention: z.boolean().default(true),
  /**
   * When true, do not request Message Content Intent (connect without privileged intent).
   * The bot only receives @mentions and DMs in guild channels — not general channel text.
   */
  mentionsOnlyMode: z.boolean().default(false),
  /** LLM gate for other messages (persona decides if worth answering). */
  relevanceGateEnabled: z.boolean().default(true),
  /** Join configured voice channels when a human joins. */
  autoJoinVoice: z.boolean().default(true),
  /** Stop TTS when a non-bot user speaks (never talk over people). */
  voiceBargeInEnabled: z.boolean().default(true),
  /** After N interrupts in one call, persona may comment on being cut off. */
  voiceInterruptAnnoyanceThreshold: z.number().int().min(1).max(20).default(3),
});

export type DiscordRuntimeConfig = z.infer<typeof discordRuntimeConfigSchema>;

export const discordConfigApplySchema = discordRuntimeConfigSchema.extend({
  botToken: z.string().min(1),
});

export const discordMessageSendSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
  replyToMessageId: z.string().optional(),
});

export const discordInboundMessageSchema = z.object({
  messageId: z.string().min(1),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  content: z.string(),
  mentionedBot: z.boolean().default(false),
  referencedBotMessage: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});

export const discordInboundBatchSchema = z.object({
  messages: z.array(discordInboundMessageSchema).min(1).max(50),
});

export const discordVoiceJoinSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
});

export const discordVoiceSpeakSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  /** Plain text — module may call TTS locally when no controller pipeline yet. */
  text: z.string().min(1).max(4000),
  /** Optional pre-encoded audio (base64 opus/pcm) from controller TTS module. */
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
});

export const discordVoiceTranscriptSchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  text: z.string(),
  final: z.boolean().default(true),
});
