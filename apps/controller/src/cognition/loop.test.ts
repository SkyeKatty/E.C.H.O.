import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@echo/llm";
import { runCognitiveLoop } from "./loop.js";
import type { ToolDefinition } from "@echo/llm";

describe("runCognitiveLoop", () => {
  it("executes tool calls via module invoker", async () => {
    const provider = new MockLLMProvider();
    provider.queue({
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "mock_echo", arguments: '{"input":"ping"}' },
          },
        ],
      },
      finishReason: "tool_calls",
    });
    provider.queue({
      message: { role: "assistant", content: "Tool said pong" },
      finishReason: "stop",
    });

    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "mock_echo",
          description: "echo",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const invoked: unknown[] = [];
    const result = await runCognitiveLoop({
      messages: [{ role: "user", content: "test" }],
      stream: false,
      options: {
        provider,
        tools,
        maxIterations: 4,
        requestTimeoutMs: 5000,
        resolveCapabilityId: (name) => (name === "mock_echo" ? "mock.echo" : name),
        invokeModule: async (_cap, params) => {
          invoked.push(params);
          return { echoed: params };
        },
      },
    });

    expect(invoked).toHaveLength(1);
    expect(result.assistantMessage.content).toBe("Tool said pong");
  });
});
