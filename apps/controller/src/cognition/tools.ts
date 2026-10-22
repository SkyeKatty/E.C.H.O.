import type { Capability } from "@echo/protocol";
import type { ToolDefinition } from "@echo/llm";
export {
  isDiscordSideEffectCapability,
  normalizeDiscordCapabilityId,
} from "@echo/discord-contract";

/** OpenAI tool names cannot contain dots; map capability ids safely. */
export function capabilityIdToToolName(capabilityId: string): string {
  return capabilityId.replace(/\./g, "_");
}

/** Resolve LLM tool name → protocol capability id (handles model naming variants). */
export function resolveToolCapabilityId(
  toolName: string,
  toolNameToCapabilityId: Map<string, string>,
): string {
  const direct = toolNameToCapabilityId.get(toolName);
  if (direct) return direct;

  const lower = toolName.toLowerCase();
  for (const [name, id] of toolNameToCapabilityId) {
    if (name.toLowerCase() === lower) return id;
  }

  if (toolName.startsWith("discord_")) {
    return toolName.replace(/^discord_/, "discord.").replace(/_/g, ".");
  }

  return toolName;
}

export function isDiscordCapabilityId(capabilityId: string): boolean {
  return capabilityId.startsWith("discord.") || capabilityId.startsWith("discord_");
}

/** Controller/module capabilities not exposed as LLM tools. */
const LLM_TOOL_DENY = new Set([
  "discord.health.get",
  "discord.config.apply",
  "discord.config.status",
  "discord.channels.list",
  "discord.voice.status",
]);

export function buildToolRouting(capabilities: Capability[]): {
  tools: ToolDefinition[];
  toolNameToCapabilityId: Map<string, string>;
} {
  const toolNameToCapabilityId = new Map<string, string>();
  const tools = capabilities
    .filter((c) => c.enabled && !LLM_TOOL_DENY.has(c.id))
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
