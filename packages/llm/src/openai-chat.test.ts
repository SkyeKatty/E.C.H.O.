import { describe, expect, it } from "vitest";
import { OpenAIChatClient } from "./openai-chat.js";

describe("OpenAIChatClient", () => {
  it("parses non-streaming completion", async () => {
    const client = new OpenAIChatClient({
      baseUrl: "http://mock.test/v1",
      defaultModel: "test-model",
      providerId: "test",
      label: "Test",
      capabilities: { toolCalling: false, streaming: true, vision: false },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "test-model",
          choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    try {
      const result = await client.complete({
        messages: [{ role: "user", content: "Hi" }],
      });
      expect(result.message.content).toBe("Hello");
      expect(result.usage?.totalTokens).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
