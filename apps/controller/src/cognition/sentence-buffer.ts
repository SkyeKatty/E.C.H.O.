/** Pull complete sentences from a growing LLM text buffer for incremental TTS. */

const SENTENCE_END = /[.!?…](?:['"\)\]]*|\s+)/;

export function drainCompleteSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = SENTENCE_END.exec(rest);
    if (!match || match.index === undefined) break;
    const endIdx = match.index + match[0].length;
    const sentence = rest.slice(0, endIdx).trim();
    rest = rest.slice(endIdx).trimStart();
    if (sentence.length >= 2) {
      sentences.push(sentence);
    }
  }
  return { sentences, remainder: rest };
}

export function flushSentenceRemainder(remainder: string): string | undefined {
  const tail = remainder.trim();
  if (tail.length < 2) return undefined;
  return tail;
}
