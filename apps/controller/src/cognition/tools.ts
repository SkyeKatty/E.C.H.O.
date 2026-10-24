import type { Capability } from "@echo/protocol";
import type { ToolDefinition } from "@echo/llm";
import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import { TIME_CAPABILITIES } from "@echo/time-contract";
import { STT_CAPABILITIES, TTS_CAPABILITIES } from "@echo/voice-contract";

/** OpenAI tool names cannot contain dots; map capability ids safely. */
export function capabilityIdToToolName(capabilityId: string): string {
  return capabilityId.replace(/\./g, "_");
}

/** Registered for controller routing but not exposed as LLM tools. */
const LLM_HIDDEN_CAPABILITY_IDS = new Set<string>([
  DISCORD_CAPABILITIES.HEALTH_GET,
  DISCORD_CAPABILITIES.CONFIG_APPLY,
  DISCORD_CAPABILITIES.CONFIG_STATUS,
  DISCORD_CAPABILITIES.VOICE_AWAIT_SILENCE,
  TIME_CAPABILITIES.HEALTH_GET,
  TTS_CAPABILITIES.HEALTH_GET,
  TTS_CAPABILITIES.CONFIG_APPLY,
  TTS_CAPABILITIES.CONFIG_STATUS,
  STT_CAPABILITIES.HEALTH_GET,
  STT_CAPABILITIES.CONFIG_APPLY,
  STT_CAPABILITIES.CONFIG_STATUS,
  STT_CAPABILITIES.SESSION_START,
  STT_CAPABILITIES.AUDIO_APPEND,
  STT_CAPABILITIES.SESSION_END,
  TTS_CAPABILITIES.SPEECH_ENQUEUE,
  TTS_CAPABILITIES.SPEECH_FLUSH,
]);

export function buildToolRouting(
  capabilities: Capability[],
  opts?: { excludeCapabilityIds?: ReadonlySet<string> },
): {
  tools: ToolDefinition[];
  toolNameToCapabilityId: Map<string, string>;
} {
  const exclude = opts?.excludeCapabilityIds;
  const toolNameToCapabilityId = new Map<string, string>();
  const tools = capabilities
    .filter(
      (c) => c.enabled && !LLM_HIDDEN_CAPABILITY_IDS.has(c.id) && !exclude?.has(c.id),
    )
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
