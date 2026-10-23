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
  /** Max messages kept in the since-last-reply backlog (plus 3 earlier lines for gate/reply context). */
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

export const discordEmojiListSchema = z.object({
  guildId: z.string().min(1).optional(),
});

export const discordMemberResolveSchema = z.object({
  guildId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  /** Username or display name fragment (case-insensitive). */
  query: z.string().min(1).max(64).optional(),
}).refine((d) => Boolean(d.userId?.trim() || d.query?.trim()), {
  message: "Provide userId or query",
});

export const discordMessageReactSchema = z.object({
  channelId: z.string().min(1),
  messageId: z.string().min(1),
  /** Unicode emoji (e.g. 👍) or custom id for guild emotes. */
  emoji: z.string().min(1).max(128),
});

export const discordMessageReactionsGetSchema = z.object({
  channelId: z.string().min(1),
  messageId: z.string().min(1),
});

export const discordReplyContextSchema = z.object({
  messageId: z.string().min(1),
  authorUserId: z.string().min(1),
  authorDisplayName: z.string().min(1),
  content: z.string(),
});

export const discordMentionedUserSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().optional(),
});

export const discordChannelActivitySchema = z.object({
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  /** Human-readable line injected into the next gate/context (e.g. reactions). */
  text: z.string().min(1).max(2000),
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
  replyTo: discordReplyContextSchema.optional(),
  mentionedUsers: z.array(discordMentionedUserSchema).optional(),
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
