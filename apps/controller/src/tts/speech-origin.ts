import type { ParticipantRef } from "../memory/participant.js";

/** Where synthesized audio should be routed (modules subscribe by sink prefix). */
export type TtsSink =
  | "twitch"
  | "stt"
  | `discord_voice:${string}:${string}`
  | (string & {});

export type SpeechOutputPlan = {
  streamId: string;
  sink: TtsSink;
};

export function twitchParticipant(channelLogin: string, userId: string, displayName: string): ParticipantRef {
  return {
    key: `twitch:${channelLogin}:${userId}`,
    displayName,
    kind: "user",
  };
}

export function sttParticipant(sessionId: string, speakerLabel: string): ParticipantRef {
  return {
    key: `stt:${sessionId}:${speakerLabel}`,
    displayName: speakerLabel,
    kind: "user",
  };
}

export function shouldUseTtsForSpeaker(speaker?: ParticipantRef): boolean {
  const key = speaker?.key ?? "";
  return key.startsWith("twitch:") || key.startsWith("stt:");
}

export function inferTtsSink(speaker?: ParticipantRef): TtsSink | null {
  if (!speaker?.key) return null;
  if (speaker.key.startsWith("twitch:")) return "twitch";
  if (speaker.key.startsWith("stt:")) return "stt";
  return null;
}

export function resolveSpeechOutputPlan(input: {
  speaker?: ParticipantRef;
  streamId?: string;
  sink?: TtsSink;
  force?: boolean;
  disable?: boolean;
}): SpeechOutputPlan | null {
  if (input.disable) return null;
  if (input.force && input.sink) {
    return { streamId: input.streamId ?? crypto.randomUUID(), sink: input.sink };
  }
  if (input.force && input.speaker) {
    const sink = input.sink ?? inferTtsSink(input.speaker);
    if (!sink) return null;
    return { streamId: input.streamId ?? crypto.randomUUID(), sink };
  }
  if (!shouldUseTtsForSpeaker(input.speaker)) return null;
  const sink = input.sink ?? inferTtsSink(input.speaker);
  if (!sink) return null;
  return { streamId: input.streamId ?? crypto.randomUUID(), sink };
}

export function discordVoiceSink(guildId: string, channelId: string): TtsSink {
  return `discord_voice:${guildId}:${channelId}`;
}

export function parseDiscordVoiceSink(sink: string): { guildId: string; channelId: string } | null {
  const m = /^discord_voice:([^:]+):([^:]+)$/.exec(sink);
  if (!m) return null;
  return { guildId: m[1]!, channelId: m[2]! };
}
