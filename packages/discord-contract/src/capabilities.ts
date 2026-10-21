export const DISCORD_CAPABILITIES = {
  HEALTH_GET: "discord.health.get",
  CONFIG_APPLY: "discord.config.apply",
  CONFIG_STATUS: "discord.config.status",
  MESSAGE_SEND: "discord.message.send",
  VOICE_JOIN: "discord.voice.join",
  VOICE_LEAVE: "discord.voice.leave",
  VOICE_STATUS: "discord.voice.status",
  VOICE_SPEAK: "discord.voice.speak",
  VOICE_SPEAK_CANCEL: "discord.voice.speak.cancel",
} as const;
