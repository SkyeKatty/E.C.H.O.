import { useCallback, useEffect, useState } from "react";

type TtsSettings = {
  enabled: boolean;
  provider: "fish" | "openrouter";
  fishBaseUrl: string;
  fishApiPath: string;
  openRouterModel: string;
  openRouterBaseUrl: string;
  maxQueueDepth: number;
  prefetchNext: boolean;
  defaultMimeType: string;
  openRouterConfigured?: boolean;
  queueDepth?: number;
};

const DEFAULT: TtsSettings = {
  enabled: true,
  provider: "fish",
  fishBaseUrl: "http://127.0.0.1:8092",
  fishApiPath: "/v1/tts",
  openRouterModel: "openai/gpt-4o-audio-preview",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  maxQueueDepth: 64,
  prefetchNext: true,
  defaultMimeType: "audio/wav",
};

export function TtsSettingsPanel(props: { moduleAvailable: boolean }) {
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT);
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/tts/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { settings: TtsSettings | null };
      if (body.settings) {
        setSettings({ ...DEFAULT, ...body.settings });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.moduleAvailable]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = { ...settings };
      if (openRouterApiKey.trim()) payload.openRouterApiKey = openRouterApiKey.trim();
      const res = await fetch("/api/v1/tts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { settings?: TtsSettings };
      if (body.settings) setSettings({ ...DEFAULT, ...body.settings });
      setOpenRouterApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Loading TTS settings…</p>;

  return (
    <div className="voice-settings-block">
      <div className="panel-head">
        <h2>Text-to-speech</h2>
        <span className={props.moduleAvailable ? "badge badge-ok" : "badge badge-off"}>
          {props.moduleAvailable ? "module connected" : "offline — pnpm dev:tts"}
        </span>
      </div>

      <p className="muted chat-hint">
        Sentence-sized chunks from the LLM are queued here. The Fish provider uses a local{" "}
        <strong>Fish Speech</strong> (Fish Audio) — <span className="mono">pnpm dev:server:fish</span> installs Python
        deps and downloads weights on first run (docs/VOICE_SERVERS.md). OpenRouter is optional.
      </p>

      {error && <div className="banner banner-warn">{error}</div>}
      {saved && <div className="banner banner-ok">TTS settings applied.</div>}

      {!props.moduleAvailable && (
        <div className="banner banner-warn">Start the TTS module to apply settings from the dashboard.</div>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
        />
        Enable TTS synthesis
      </label>

      <div className="form-grid">
        <label>
          Provider
          <select
            className="chat-select"
            value={settings.provider}
            onChange={(e) =>
              setSettings((s) => ({ ...s, provider: e.target.value as TtsSettings["provider"] }))
            }
          >
            <option value="fish">Fish Speech (Fish Audio, local)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <label className="checkbox-row align-end">
          <input
            type="checkbox"
            checked={settings.prefetchNext}
            onChange={(e) => setSettings((s) => ({ ...s, prefetchNext: e.target.checked }))}
          />
          Prefetch next line while playing
        </label>
      </div>

      {settings.provider === "fish" && (
        <div className="form-grid">
          <label>
            Fish base URL
            <input
              className="text-input mono"
              value={settings.fishBaseUrl}
              onChange={(e) => setSettings((s) => ({ ...s, fishBaseUrl: e.target.value }))}
            />
          </label>
          <label>
            Fish API path
            <input
              className="text-input mono"
              value={settings.fishApiPath}
              onChange={(e) => setSettings((s) => ({ ...s, fishApiPath: e.target.value }))}
            />
          </label>
        </div>
      )}

      {settings.provider === "openrouter" && (
        <>
          <div className="form-grid">
            <label>
              OpenRouter base URL
              <input
                className="text-input mono"
                value={settings.openRouterBaseUrl}
                onChange={(e) => setSettings((s) => ({ ...s, openRouterBaseUrl: e.target.value }))}
              />
            </label>
            <label>
              Model id
              <input
                className="text-input mono"
                value={settings.openRouterModel}
                onChange={(e) => setSettings((s) => ({ ...s, openRouterModel: e.target.value }))}
              />
            </label>
          </div>
          <label>
            OpenRouter API key {settings.openRouterConfigured && !openRouterApiKey ? "(configured)" : ""}
            <input
              type="password"
              className="text-input"
              placeholder={
                settings.openRouterConfigured ? "Leave blank to keep current key" : "sk-or-… or env OPENROUTER_API_KEY"
              }
              value={openRouterApiKey}
              onChange={(e) => setOpenRouterApiKey(e.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      )}

      <label>
        Max queue depth
        <input
          type="number"
          className="text-input"
          min={1}
          max={500}
          value={settings.maxQueueDepth}
          onChange={(e) => setSettings((s) => ({ ...s, maxQueueDepth: Number(e.target.value) }))}
        />
      </label>

      {typeof settings.queueDepth === "number" && (
        <p className="muted mono">Current queue depth: {settings.queueDepth}</p>
      )}

      <button type="button" className="btn-primary" disabled={saving || !props.moduleAvailable} onClick={() => void save()}>
        {saving ? "Saving…" : "Save TTS settings"}
      </button>
    </div>
  );
}
