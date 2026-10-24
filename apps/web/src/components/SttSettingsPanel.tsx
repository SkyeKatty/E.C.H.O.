import { useCallback, useEffect, useState } from "react";

type SttSettings = {
  enabled: boolean;
  provider: "local-http" | "groq";
  transcriptionBaseUrl: string;
  model: string;
  language?: string;
  maxSessionSeconds: number;
  groqConfigured?: boolean;
  activeSessions?: number;
};

const DEFAULT: SttSettings = {
  enabled: true,
  provider: "local-http",
  transcriptionBaseUrl: "http://127.0.0.1:8091/v1",
  model: "whisper-1",
  maxSessionSeconds: 45,
};

export function SttSettingsPanel(props: { moduleAvailable: boolean }) {
  const [settings, setSettings] = useState<SttSettings>(DEFAULT);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/stt/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { settings: SttSettings | null };
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
      if (groqApiKey.trim()) payload.groqApiKey = groqApiKey.trim();
      const res = await fetch("/api/v1/stt/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { settings?: SttSettings };
      if (body.settings) setSettings({ ...DEFAULT, ...body.settings });
      setGroqApiKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Loading STT settings…</p>;

  return (
    <div className="voice-settings-block">
      <div className="panel-head">
        <h2>Speech-to-text</h2>
        <span className={props.moduleAvailable ? "badge badge-ok" : "badge badge-off"}>
          {props.moduleAvailable ? "module connected" : "offline — pnpm dev:stt"}
        </span>
      </div>

      <p className="muted chat-hint">
        Discord voice streams PCM here when connected. Default is a free local OpenAI-compatible Whisper server;
        Groq Whisper is optional (free tier).
      </p>

      {error && <div className="banner banner-warn">{error}</div>}
      {saved && <div className="banner banner-ok">STT settings applied.</div>}

      {!props.moduleAvailable && (
        <div className="banner banner-warn">Start the STT module to apply settings from the dashboard.</div>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
        />
        Enable STT processing
      </label>

      <div className="form-grid">
        <label>
          Provider
          <select
            className="chat-select"
            value={settings.provider}
            onChange={(e) =>
              setSettings((s) => ({ ...s, provider: e.target.value as SttSettings["provider"] }))
            }
          >
            <option value="local-http">Local HTTP (Whisper-compatible)</option>
            <option value="groq">Groq (free tier API)</option>
          </select>
        </label>
        <label>
          Model
          <input
            className="text-input mono"
            value={settings.model}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
          />
        </label>
      </div>

      {settings.provider === "local-http" && (
        <label>
          Transcription base URL
          <input
            className="text-input mono"
            value={settings.transcriptionBaseUrl}
            onChange={(e) => setSettings((s) => ({ ...s, transcriptionBaseUrl: e.target.value }))}
            placeholder="http://127.0.0.1:8091/v1"
          />
        </label>
      )}

      {settings.provider === "groq" && (
        <label>
          Groq API key {settings.groqConfigured && !groqApiKey ? "(configured)" : ""}
          <input
            type="password"
            className="text-input"
            placeholder={settings.groqConfigured ? "Leave blank to keep current key" : "gsk_…"}
            value={groqApiKey}
            onChange={(e) => setGroqApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}

      <div className="form-grid">
        <label>
          Language (optional ISO code)
          <input
            className="text-input mono"
            value={settings.language ?? ""}
            onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value || undefined }))}
            placeholder="en"
          />
        </label>
        <label>
          Max utterance seconds
          <input
            type="number"
            className="text-input"
            min={5}
            max={120}
            value={settings.maxSessionSeconds}
            onChange={(e) => setSettings((s) => ({ ...s, maxSessionSeconds: Number(e.target.value) }))}
          />
        </label>
      </div>

      {typeof settings.activeSessions === "number" && (
        <p className="muted mono">Active capture sessions: {settings.activeSessions}</p>
      )}

      <button type="button" className="btn-primary" disabled={saving || !props.moduleAvailable} onClick={() => void save()}>
        {saving ? "Saving…" : "Save STT settings"}
      </button>
    </div>
  );
}
