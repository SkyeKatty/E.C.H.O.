/** Capability IDs for STT modules (Discord voice streams audio through the controller). */
export const STT_CAPABILITIES = {
  HEALTH_GET: "stt.health.get",
  CONFIG_APPLY: "stt.config.apply",
  CONFIG_STATUS: "stt.config.status",
  SESSION_START: "stt.session.start",
  AUDIO_APPEND: "stt.audio.append",
  SESSION_END: "stt.session.end",
  /** One-shot transcribe (testing); normal path is session + append + end. */
  TRANSCRIBE_STREAM: "stt.transcribe.stream",
} as const;

/** @deprecated use HEALTH_GET */
export const STT_CAPABILITIES_LEGACY = {
  HEALTH: STT_CAPABILITIES.HEALTH_GET,
} as const;

export const TTS_CAPABILITIES = {
  HEALTH_GET: "tts.health.get",
  CONFIG_APPLY: "tts.config.apply",
  CONFIG_STATUS: "tts.config.status",
  SPEECH_ENQUEUE: "tts.speech.enqueue",
  SPEECH_FLUSH: "tts.speech.flush",
  /** Direct one-shot synth (testing); normal path is enqueue + playback events. */
  SYNTHESIZE: "tts.synthesize",
  SYNTHESIZE_STREAM: "tts.synthesize.stream",
} as const;

/** @deprecated use HEALTH_GET */
export const TTS_CAPABILITIES_LEGACY = {
  HEALTH: TTS_CAPABILITIES.HEALTH_GET,
} as const;
