import type { ChatMessage } from "@echo/llm";

/** User-facing LLM text normalization (persona chat, Discord, voice). */
export function formatLlmOutput(text: string): string {
  return text.replaceAll("\u2014", ", ");
}

/** Sanitize the last assistant message in a turn (after tool calls). */
export function formatAssistantTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role === "assistant" && m.content) {
      out[i] = { ...m, content: formatLlmOutput(m.content) };
      break;
    }
  }
  return out;
}
