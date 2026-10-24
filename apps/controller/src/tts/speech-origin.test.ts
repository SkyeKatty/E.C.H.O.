import { describe, expect, it } from "vitest";
import {
  discordVoiceSink,
  inferTtsSink,
  resolveSpeechOutputPlan,
  shouldUseTtsForSpeaker,
  sttParticipant,
  twitchParticipant,
} from "./speech-origin.js";

describe("shouldUseTtsForSpeaker", () => {
  it("enables TTS for twitch and stt speakers", () => {
    expect(shouldUseTtsForSpeaker(twitchParticipant("channel", "u1", "User"))).toBe(true);
    expect(shouldUseTtsForSpeaker(sttParticipant("sess", "Mic"))).toBe(true);
    expect(shouldUseTtsForSpeaker({ key: "discord:g:c", displayName: "x", kind: "user" })).toBe(
      false,
    );
  });
});

describe("resolveSpeechOutputPlan", () => {
  it("infers twitch sink from speaker", () => {
    const plan = resolveSpeechOutputPlan({
      speaker: twitchParticipant("ch", "id", "Name"),
      streamId: "s1",
    });
    expect(plan).toEqual({ streamId: "s1", sink: "twitch" });
  });

  it("uses explicit discord voice sink when forced", () => {
    const sink = discordVoiceSink("g1", "c1");
    const plan = resolveSpeechOutputPlan({
      speaker: sttParticipant("sess", "Voice"),
      force: true,
      sink,
      streamId: "v1",
    });
    expect(plan).toEqual({ streamId: "v1", sink });
  });

  it("returns null when disabled", () => {
    expect(
      resolveSpeechOutputPlan({
        speaker: sttParticipant("s", "x"),
        disable: true,
      }),
    ).toBeNull();
  });
});

describe("inferTtsSink", () => {
  it("maps stt keys to stt sink", () => {
    expect(inferTtsSink(sttParticipant("s", "label"))).toBe("stt");
  });
});
