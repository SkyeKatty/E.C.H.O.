/** JSON Schema for LLM-exposed Discord tools. */

export const discordMessageSendToolSchema = {
  type: "object",
  properties: {
    channelId: {
      type: "string",
      description: "Text channel snowflake; omit in Discord chat (current channel is injected).",
    },
    content: {
      type: "string",
      description:
        "Message text. Use <:name:id> or <a:name:id> for custom emotes (see discord_emoji_list). Mention users with <@userId>.",
    },
    replyToMessageId: { type: "string", description: "Optional message id to reply to" },
  },
  required: ["content"],
  additionalProperties: false,
} as const;

export const discordEmojiListToolSchema = {
  type: "object",
  properties: {
    guildId: { type: "string", description: "Guild snowflake; omit when configured for a single guild" },
  },
  additionalProperties: false,
} as const;

export const discordMemberResolveToolSchema = {
  type: "object",
  properties: {
    guildId: { type: "string" },
    userId: { type: "string", description: "Exact Discord user id" },
    query: {
      type: "string",
      description: "Username or display name to search (for @mentions and timers)",
    },
  },
  additionalProperties: false,
} as const;

export const discordMessageReactToolSchema = {
  type: "object",
  properties: {
    channelId: {
      type: "string",
      description: "Omit in Discord chat — current channel is injected automatically.",
    },
    messageId: { type: "string", description: "From [id:…] on chat lines" },
    emoji: {
      type: "string",
      description: "Unicode emoji or custom emote name/id from discord_emoji_list",
    },
  },
  required: ["messageId", "emoji"],
  additionalProperties: false,
} as const;

export const discordVoiceJoinToolSchema = {
  type: "object",
  properties: {
    guildId: {
      type: "string",
      description: "Guild snowflake; omit in Discord chat (current guild is injected).",
    },
    channelId: {
      type: "string",
      description: "Voice channel snowflake if you already have it.",
    },
    query: {
      type: "string",
      description: 'Voice channel name to join, e.g. "Lobby A". Use when channelId is unknown.',
    },
  },
  additionalProperties: false,
} as const;

export const discordVoiceLeaveToolSchema = {
  ...discordVoiceJoinToolSchema,
} as const;

export const discordVoiceSpeakToolSchema = {
  type: "object",
  properties: {
    guildId: { type: "string", description: "Omit in Discord chat — guild is injected." },
    channelId: { type: "string", description: "Voice channel snowflake" },
    query: { type: "string", description: "Voice channel name if channelId unknown" },
    text: { type: "string", description: "Plain text to speak (TTS when configured)" },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

export const discordMessageReactionsGetToolSchema = {
  type: "object",
  properties: {
    channelId: {
      type: "string",
      description: "Omit in Discord chat — current channel is injected automatically.",
    },
    messageId: { type: "string", description: "From [id:…] on chat lines" },
  },
  required: ["messageId"],
  additionalProperties: false,
} as const;
