/** JSON Schema for LLM tool calling (OpenAI function parameters). */

export const discordVoiceChannelToolSchema = {
  type: "object",
  properties: {
    channelName: {
      type: "string",
      description:
        "Voice channel name (e.g. Lounge). Prefer this when names appear in the Discord channels section of your instructions.",
    },
    channelId: {
      type: "string",
      description: "Voice channel snowflake ID (alternative to channelName)",
    },
    guildId: {
      type: "string",
      description: "Guild snowflake; omit when the bot is configured for a single guild",
    },
  },
  anyOf: [{ required: ["channelName"] }, { required: ["channelId"] }],
  additionalProperties: false,
} as const;

export const discordVoiceLeaveToolSchema = {
  type: "object",
  properties: {
    channelName: {
      type: "string",
      description: "Voice channel name to leave; omit to disconnect from the guild entirely",
    },
    channelId: {
      type: "string",
      description: "Voice channel snowflake ID (alternative to channelName)",
    },
    guildId: {
      type: "string",
      description: "Guild snowflake; omit when the bot is configured for a single guild",
    },
  },
  additionalProperties: false,
} as const;

export const discordMessageSendToolSchema = {
  type: "object",
  properties: {
    channelId: { type: "string", description: "Text channel snowflake ID" },
    content: { type: "string", description: "Message text (max 2000 chars)" },
    replyToMessageId: { type: "string", description: "Optional message id to reply to" },
  },
  required: ["channelId", "content"],
  additionalProperties: false,
} as const;
