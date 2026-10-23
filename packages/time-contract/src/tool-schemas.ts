/** JSON Schema fragments for LLM tool registration (OpenAI function parameters). */

export const timeNowToolSchema = {
  type: "object",
  properties: {
    timezone: {
      type: "string",
      description:
        "IANA timezone with DST rules (e.g. America/Halifax, America/New_York). Defaults to ECHO_TIME_TIMEZONE or the host zone. Use localTime/localDateTime in the response for users — not iso (UTC).",
    },
  },
  additionalProperties: false,
} as const;

export const timeDateToolSchema = {
  type: "object",
  properties: {
    timezone: {
      type: "string",
      description: "IANA timezone for the calendar date. Defaults to server local timezone.",
    },
  },
  additionalProperties: false,
} as const;

export const timeTimerCreateToolSchema = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description:
        "What this timer is for — when it fires, the persona will be prompted to speak about this in character.",
    },
    delaySeconds: {
      type: "integer",
      minimum: 1,
      maximum: 86400,
      description: "Seconds until the timer fires (use this or delayMinutes).",
    },
    delayMinutes: {
      type: "integer",
      minimum: 1,
      maximum: 1440,
      description: "Minutes until the timer fires (use this or delaySeconds).",
    },
    notifyDiscord: {
      type: "object",
      description: "If set, post the persona's timer message to this Discord text channel when the timer fires.",
      properties: {
        channelId: { type: "string" },
        guildId: { type: "string" },
      },
      required: ["channelId"],
      additionalProperties: false,
    },
    mentionUserIds: {
      type: "array",
      items: { type: "string" },
      description: "Discord user ids to @mention when the timer fires (from discord_member_resolve).",
    },
    mentionUsernames: {
      type: "array",
      items: { type: "string" },
      description: "Usernames/display names to remind — controller resolves to ids when possible.",
    },
  },
  required: ["description"],
  additionalProperties: false,
} as const;

export const timeTimerListToolSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const timeTimerCancelToolSchema = {
  type: "object",
  properties: {
    timerId: { type: "string", description: "UUID of the timer to cancel" },
  },
  required: ["timerId"],
  additionalProperties: false,
} as const;
