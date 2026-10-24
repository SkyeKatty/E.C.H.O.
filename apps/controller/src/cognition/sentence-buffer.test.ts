import { describe, expect, it } from "vitest";
import { drainCompleteSentences, flushSentenceRemainder } from "./sentence-buffer.js";

describe("drainCompleteSentences", () => {
  it("emits complete sentences and keeps remainder", () => {
    const { sentences, remainder } = drainCompleteSentences("Hello there. Still going");
    expect(sentences).toEqual(["Hello there."]);
    expect(remainder).toBe("Still going");
  });

  it("handles multiple sentences in one buffer", () => {
    const { sentences, remainder } = drainCompleteSentences("One. Two! Three?");
    expect(sentences).toEqual(["One.", "Two!", "Three?"]);
    expect(remainder).toBe("");
  });
});

describe("flushSentenceRemainder", () => {
  it("returns trimmed tail when long enough", () => {
    expect(flushSentenceRemainder("no period here")).toBe("no period here");
  });

  it("drops very short tails", () => {
    expect(flushSentenceRemainder("a")).toBeUndefined();
  });
});
