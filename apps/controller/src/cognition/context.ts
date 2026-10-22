import type { ChatMessage } from "@echo/llm";
import type { CharacterCard } from "../characters/schema.js";
import { buildCharacterSystemPrompt, type RuntimePersonaPolicy } from "../characters/prompt.js";
import type { PersonaOperationalState } from "../persona/state.js";

export function assembleChatMessages(input: {
  character: CharacterCard;
  policy: RuntimePersonaPolicy;
  state: PersonaOperationalState;
  history: ChatMessage[];
  userMessage: string;
  memoryInjection?: string;
  discordInjection?: string;
  historyLimit?: number;
}): ChatMessage[] {
  let system = buildCharacterSystemPrompt({
    card: input.character,
    state: input.state,
    policy: input.policy,
  });

  if (input.discordInjection?.trim()) {
    system = `${system}\n\n${input.discordInjection.trim()}`;
  }

  if (input.memoryInjection?.trim()) {
    system = `${system}\n\n${input.memoryInjection.trim()}`;
  }

  const limit = input.historyLimit ?? input.history.length;
  const history = input.history.slice(-limit);

  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: input.userMessage },
  ];
}
