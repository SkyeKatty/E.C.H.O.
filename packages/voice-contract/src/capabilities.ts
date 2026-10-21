/** Capability IDs for future STT/TTS modules (Discord voice routes through the controller). */
export const STT_CAPABILITIES = {
  HEALTH: "stt.health.get",
  TRANSCRIBE_STREAM: "stt.transcribe.stream",
} as const;

export const TTS_CAPABILITIES = {
  HEALTH: "tts.health.get",
  SYNTHESIZE: "tts.synthesize",
  SYNTHESIZE_STREAM: "tts.synthesize.stream",
} as const;
