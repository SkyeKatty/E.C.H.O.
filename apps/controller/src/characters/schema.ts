import { z } from "zod";

export const referenceImageSchema = z.object({
  id: z.string().uuid(),
  /** Public URL or `/api/v1/characters/.../assets/...` path after upload */
  url: z.string().optional(),
  caption: z.string().optional(),
  description: z.string().optional(),
});

export type ReferenceImage = z.infer<typeof referenceImageSchema>;

export const characterCardSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  tagline: z.string().max(300).optional(),
  summary: z.string().max(4000).optional(),
  personality: z.string().max(8000).optional(),
  mannerisms: z.string().max(4000).optional(),
  speechStyle: z.string().max(4000).optional(),
  physicalAppearance: z.string().max(4000).optional(),
  background: z.string().max(8000).optional(),
  behavioralRules: z.string().max(4000).optional(),
  referenceImages: z.array(referenceImageSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CharacterCard = z.infer<typeof characterCardSchema>;

export const characterCardInputSchema = characterCardSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({
    name: z.string().min(1).max(120),
  });

export type CharacterCardInput = z.infer<typeof characterCardInputSchema>;

export const characterCardUpdateSchema = characterCardSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial();

export type CharacterCardSummary = Pick<CharacterCard, "id" | "name" | "tagline" | "updatedAt">;

export const activeCharacterSchema = z.object({
  activeCharacterId: z.string().uuid().nullable(),
});
