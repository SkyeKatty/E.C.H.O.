/** JSON Schema for LLM-exposed Discord tools. */

export const discordMessageSendToolSchema = {
  type: "object",
  properties: {
    channelId: { type: "string", description: "Text channel snowflake" },
    content: {
      type: "string",
      description:
        "Message text. Use <:name:id> or <a:name:id> for custom emotes (see discord_emoji_list). Mention users with <@userId>.",
    },
    replyToMessageId: { type: "string", description: "Optional message id to reply to" },
  },
  required: ["channelId", "content"],
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
    channelId: { type: "string" },
    messageId: { type: "string" },
    emoji: {
      type: "string",
      description: "Unicode emoji or custom emote name/id from discord_emoji_list",
    },
  },
  required: ["channelId", "messageId", "emoji"],
  additionalProperties: false,
} as const;

export const discordMessageReactionsGetToolSchema = {
  type: "object",
  properties: {
    channelId: { type: "string" },
    messageId: { type: "string" },
  },
  required: ["channelId", "messageId"],
  additionalProperties: false,
} as const;
