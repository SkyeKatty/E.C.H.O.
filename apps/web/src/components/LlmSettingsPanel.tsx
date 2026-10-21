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

type SettingsResponse = {
  settings: {
    activeProviderId: string;
    providers: ProviderProfile[];
  };
  loadErrors: string[];
};

const categoryLabel: Record<ProviderCategory, string> = {
  openrouter: "OpenRouter",
  local: "Local GPU",
  remote_api: "Remote API",
};

export function LlmSettingsPanel(props: { moduleAvailable: boolean }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ProviderProfile | null>(null);
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
            <span>Provider</span>
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
            <span>Model</span>
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
              <span>Max tokens</span>
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
