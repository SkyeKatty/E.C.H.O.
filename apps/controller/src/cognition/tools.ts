import type { Capability } from "@echo/protocol";
import type { ToolDefinition } from "@echo/llm";

/** OpenAI tool names cannot contain dots; map capability ids safely. */
export function capabilityIdToToolName(capabilityId: string): string {
  return capabilityId.replace(/\./g, "_");
}

export function buildToolRouting(capabilities: Capability[]): {
  tools: ToolDefinition[];
  toolNameToCapabilityId: Map<string, string>;
} {
  const toolNameToCapabilityId = new Map<string, string>();
  const tools = capabilities
    .filter((c) => c.enabled)
    .map((cap) => {
      const name = capabilityIdToToolName(cap.id);
      toolNameToCapabilityId.set(name, cap.id);
      return {
        type: "function" as const,
        function: {
          name,
          description: cap.description ?? cap.name,
          parameters: (cap.inputSchema as Record<string, unknown> | undefined) ?? {
            type: "object",
            properties: {
              input: { type: "string", description: "Optional input for the capability" },
            },
            additionalProperties: true,
          },
        },
      };
    });
  return { tools, toolNameToCapabilityId };
}
