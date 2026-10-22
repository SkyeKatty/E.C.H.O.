import { describe, expect, it } from "vitest";
import { defaultRuntimeSettings } from "./settings.js";
import { resolveTaskBinding } from "./tasks.js";

describe("resolveTaskBinding", () => {
  it("uses active provider and default model when task unset", () => {
    const settings = defaultRuntimeSettings();
    const b = resolveTaskBinding(settings, "discord_gate");
    expect(b.providerId).toBe("openrouter");
    expect(b.model).toBe("openai/gpt-4o-mini");
  });

  it("applies task model override", () => {
    const settings = defaultRuntimeSettings();
    settings.tasks = { discord_gate: { model: "deepseek/deepseek-chat" } };
    const b = resolveTaskBinding(settings, "discord_gate");
    expect(b.model).toBe("deepseek/deepseek-chat");
  });
});
