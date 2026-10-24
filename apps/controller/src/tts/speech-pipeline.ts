import {
  drainCompleteSentences,
  flushSentenceRemainder,
} from "../cognition/sentence-buffer.js";
import type { TtsModuleService } from "./tts-module-service.js";
import type { SpeechOutputPlan } from "./speech-origin.js";

/** Streams LLM deltas into sentence-sized TTS enqueue calls. */
export class SpeechStreamPipeline {
  private buffer = "";
  private sequence = 0;

  constructor(
    private readonly tts: TtsModuleService,
    private readonly plan: SpeechOutputPlan,
  ) {}

  async onDelta(delta: string): Promise<void> {
    if (!delta) return;
    this.buffer += delta;
    const { sentences, remainder } = drainCompleteSentences(this.buffer);
    this.buffer = remainder;
    for (const sentence of sentences) {
      this.enqueue(sentence);
    }
  }

  async flush(): Promise<void> {
    const tailFromBuffer = flushSentenceRemainder(this.buffer);
    this.buffer = "";
    if (tailFromBuffer) {
      const seq = this.sequence++;
      await this.tts
        .enqueueSpeech({
          streamId: this.plan.streamId,
          sequence: seq,
          text: tailFromBuffer,
          sink: this.plan.sink,
        })
        .catch(() => {});
    }
    await this.tts.flushSpeech({
      streamId: this.plan.streamId,
      sink: this.plan.sink,
    });
  }

  private enqueue(text: string): void {
    const seq = this.sequence++;
    void this.tts
      .enqueueSpeech({
        streamId: this.plan.streamId,
        sequence: seq,
        text,
        sink: this.plan.sink,
      })
      .catch(() => {});
  }
}
