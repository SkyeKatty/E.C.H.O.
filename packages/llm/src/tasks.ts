import { z } from "zod";
import type { LlmRuntimeSettings, ProviderProfile } from "./settings.js";

export const llmTaskSchema = z.enum(["chat", "discord_gate", "episode_summary", "memory_extract"]);
export type LlmTask = z.infer<typeof llmTaskSchema>;

export const taskModelBindingSchema = z.object({
  /** Provider profile id; defaults to active provider. */
  providerId: z.string().min(1).optional(),
  /** Model slug for this task; defaults to the chosen provider's default model. */
  model: z.string().min(1).optional(),
});

export type TaskModelBinding = z.infer<typeof taskModelBindingSchema>;

export const llmTaskBindingsSchema = z.object({
  chat: taskModelBindingSchema.optional(),
  discord_gate: taskModelBindingSchema.optional(),
  episode_summary: taskModelBindingSchema.optional(),
  memory_extract: taskModelBindingSchema.optional(),
});

export type LlmTaskBindings = z.infer<typeof llmTaskBindingsSchema>;

export function resolveTaskBinding(
  settings: LlmRuntimeSettings,
  task: LlmTask,
): { providerId: string; model: string; profile: ProviderProfile } {
  const override = settings.tasks?.[task];
  const providerId = override?.providerId ?? settings.activeProviderId;
  let profile = settings.providers.find((p) => p.id === providerId && p.enabled);
  if (!profile) {
    profile = settings.providers.find((p) => p.id === settings.activeProviderId && p.enabled);
  }
  if (!profile) {
    profile = settings.providers.find((p) => p.enabled);
  }
  if (!profile) {
    throw new Error("No enabled LLM provider profile");
  }
  const model = override?.model?.trim() || profile.model;
  return { providerId: profile.id, model, profile };
}

export const LLM_TASK_LABELS: Record<LlmTask, string> = {
  chat: "Main chat & Discord replies",
  discord_gate: "Discord relevance gate",
  episode_summary: "Episode summarization",
  memory_extract: "Memory extraction",
};
