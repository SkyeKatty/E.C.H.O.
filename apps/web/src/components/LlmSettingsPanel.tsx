import { useCallback, useEffect, useState } from "react";

type ProviderCategory = "openrouter" | "local" | "remote_api";

type ProviderProfile = {
  id: string;
  kind: "openrouter" | "openai_compatible";
  label: string;
  enabled: boolean;
  model: string;
  baseUrl?: string;
  category: ProviderCategory;
  generation: { temperature: number; maxTokens: number };
};

type TaskBinding = {
  providerId?: string;
  model?: string;
};

type TaskKey = "chat" | "discord_gate" | "episode_summary" | "memory_extract";

type TaskBindings = Partial<Record<TaskKey, TaskBinding>>;

type SettingsResponse = {
  settings: {
    activeProviderId: string;
    providers: ProviderProfile[];
    tasks?: TaskBindings;
  };
  loadErrors: string[];
};

const categoryLabel: Record<ProviderCategory, string> = {
  openrouter: "OpenRouter",
  local: "Local GPU",
  remote_api: "Remote API",
};

const TASK_ROWS: { key: TaskKey; label: string; hint: string }[] = [
  {
    key: "chat",
    label: "Main chat & Discord replies",
    hint: "Primary persona responses (tools + streaming).",
  },
  {
    key: "discord_gate",
    label: "Discord relevance gate",
    hint: "Small JSON decision per message; use a fast/cheap model.",
  },
  {
    key: "episode_summary",
    label: "Episode summarization",
    hint: "Rolling compaction of old channel/chat history.",
  },
  {
    key: "memory_extract",
    label: "Memory extraction",
    hint: "Structured facts after each chat turn.",
  },
];

const emptyTasks = (): TaskBindings => ({});

export function LlmSettingsPanel(props: { moduleAvailable: boolean }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ProviderProfile | null>(null);
  const [tasks, setTasks] = useState<TaskBindings>(emptyTasks());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!props.moduleAvailable) {
      setSettings(null);
      return;
    }
    try {
      const res = await fetch("/api/v1/llm/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SettingsResponse;
      setSettings(data);
      const active = data.settings.activeProviderId;
      setSelectedId(active);
      const profile = data.settings.providers.find((p) => p.id === active) ?? data.settings.providers[0];
      setDraft(profile ? { ...profile } : null);
      setTasks({ ...emptyTasks(), ...(data.settings.tasks ?? {}) });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, [props.moduleAvailable]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!settings || !selectedId) return;
    const profile = settings.settings.providers.find((p) => p.id === selectedId);
    if (profile) setDraft({ ...profile });
  }, [selectedId, settings]);

  function setTaskField(key: TaskKey, field: keyof TaskBinding, value: string) {
    setTasks((prev) => {
      const row = { ...prev[key] };
      if (value.trim()) {
        row[field] = value.trim();
      } else {
        delete row[field];
      }
      const next = { ...prev };
      if (Object.keys(row).length === 0) {
        delete next[key];
      } else {
        next[key] = row;
      }
      return next;
    });
  }

  async function applySettings() {
    if (!draft) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/v1/llm/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeProviderId: selectedId,
          tasks,
          profile: {
            id: draft.id,
            model: draft.model,
            baseUrl: draft.kind === "openai_compatible" ? draft.baseUrl : undefined,
            generation: draft.generation,
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SettingsResponse;
      setSettings(data);
      setTasks({ ...emptyTasks(), ...(data.settings.tasks ?? {}) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!props.moduleAvailable) {
    return (
      <section className="panel">
        <h2>LLM configuration</h2>
        <p className="muted">
          Start the LLM module to configure providers from the dashboard:{" "}
          <span className="mono">pnpm dev:llm</span>
        </p>
      </section>
    );
  }

  const providers = settings?.settings.providers.filter((p) => p.enabled) ?? [];

  return (
    <section className="panel llm-settings">
      <div className="panel-head">
        <h2>LLM configuration</h2>
        {saved && <span className="badge badge-ok">Saved</span>}
      </div>

      {settings?.loadErrors.length ? (
        <div className="banner banner-warn">
          Provider load warnings: {settings.loadErrors.join("; ")}
        </div>
      ) : null}

      {error && <div className="banner banner-warn">{error}</div>}

      {draft && (
        <div className="llm-form">
          <label className="field">
            <span>Active provider (default credentials)</span>
            <select
              className="chat-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {settings?.settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({categoryLabel[p.category]})
                </option>
              ))}
            </select>
          </label>

          <p className="muted mono llm-kind">
            Type: {categoryLabel[draft.category]} · backend: {draft.kind}
          </p>

          <label className="field">
            <span>Default model (when a task has no override)</span>
            <input
              className="text-input mono"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </label>

          {draft.kind === "openai_compatible" && (
            <label className="field">
              <span>API base URL</span>
              <input
                className="text-input mono"
                value={draft.baseUrl ?? ""}
                placeholder="http://127.0.0.1:11434/v1"
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              />
            </label>
          )}

          <div className="field-row">
            <label className="field">
              <span>Temperature ({draft.generation.temperature.toFixed(2)})</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={draft.generation.temperature}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    generation: { ...draft.generation, temperature: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>Max tokens (chat default)</span>
              <input
                type="number"
                className="text-input mono"
                min={1}
                max={128000}
                value={draft.generation.maxTokens}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    generation: { ...draft.generation, maxTokens: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>

          <h3>Per-task models</h3>
          <p className="muted chat-hint">
            Optional OpenRouter (or provider) model per job. Leave blank to use the active provider&apos;s default
            model above. Pick another provider when a task should use different API credentials.
          </p>

          <ul className="llm-task-list">
            {TASK_ROWS.map((row) => {
              const binding = tasks[row.key] ?? {};
              return (
                <li key={row.key} className="llm-task-row">
                  <div className="llm-task-head">
                    <strong>{row.label}</strong>
                    <span className="muted">{row.hint}</span>
                  </div>
                  <div className="form-grid">
                    <label>
                      Provider
                      <select
                        className="chat-select"
                        value={binding.providerId ?? ""}
                        onChange={(e) => setTaskField(row.key, "providerId", e.target.value)}
                      >
                        <option value="">Active provider</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Model override
                      <input
                        className="text-input mono"
                        placeholder="e.g. deepseek/deepseek-chat"
                        value={binding.model ?? ""}
                        onChange={(e) => setTaskField(row.key, "model", e.target.value)}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>

          {draft.category === "openrouter" && (
            <p className="muted chat-hint">
              OpenRouter requires <span className="mono">OPENROUTER_API_KEY</span> in{" "}
              <span className="mono">.env</span> at the project root (loaded by the LLM module). Restart{" "}
              <span className="mono">pnpm dev:llm</span> after adding it.
            </p>
          )}

          <button type="button" className="btn-primary" disabled={saving} onClick={() => void applySettings()}>
            {saving ? "Applying…" : "Apply settings"}
          </button>
        </div>
      )}
    </section>
  );
}
