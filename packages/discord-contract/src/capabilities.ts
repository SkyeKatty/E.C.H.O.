export const DISCORD_CAPABILITIES = {
  HEALTH_GET: "discord.health.get",
  CONFIG_APPLY: "discord.config.apply",
  CONFIG_STATUS: "discord.config.status",
  MESSAGE_SEND: "discord.message.send",
  EMOJI_LIST: "discord.emoji.list",
  MEMBER_RESOLVE: "discord.member.resolve",
  MESSAGE_REACT: "discord.message.react",
  MESSAGE_REACTIONS_GET: "discord.message.reactions.get",
  VOICE_JOIN: "discord.voice.join",
  VOICE_LEAVE: "discord.voice.leave",
  VOICE_STATUS: "discord.voice.status",
  VOICE_SPEAK: "discord.voice.speak",
  VOICE_SPEAK_CANCEL: "discord.voice.speak.cancel",
  /** Block until no human speaking / STT capture in channel (courtesy gate before LLM or TTS). */
  VOICE_AWAIT_SILENCE: "discord.voice.awaitSilence",
} as const;
