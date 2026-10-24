/** Use in character cards, config, and internal prompt templates. */
export const CHARACTER_NAME_PLACEHOLDER = "{{characterName}}";

export type PersonaPlaceholderContext = {
  characterName: string;
};

export function expandPersonaPlaceholders(
  text: string,
  ctx: PersonaPlaceholderContext,
): string {
  if (!text) return text;
  const name = ctx.characterName.trim() || "Echo";
  return text
    .replaceAll(CHARACTER_NAME_PLACEHOLDER, name)
    .replaceAll("{{personaName}}", name);
}

/** Scrub generic labels from text destined for long-term memory. */
export function normalizeMemoryProse(text: string, characterName: string): string {
  const name = characterName.trim();
  if (!name || !text) return text;
  return text
    .replace(/\bthe persona\b/gi, name)
    .replace(/\bthe assistant\b/gi, name)
    .replace(/\bthe AI persona\b/gi, name)
    .replace(/\bthe AI assistant\b/gi, name);
}
