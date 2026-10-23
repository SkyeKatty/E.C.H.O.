import { useCallback, useEffect, useState } from "react";

type ChannelPolicy = {
  channelId: string;
  enabled: boolean;
  textEnabled: boolean;
  voiceEnabled: boolean;
};

type DiscordSettings = {
  enabled: boolean;
  botTokenConfigured: boolean;
  guildId?: string;
  channels: ChannelPolicy[];
  batchWindowMs: number;
  batchMaxMessages: number;
  alwaysRespondToMention: boolean;
  relevanceGateEnabled: boolean;
  autoJoinVoice: boolean;
  voiceBargeInEnabled: boolean;
  voiceInterruptAnnoyanceThreshold: number;
  mentionsOnlyMode: boolean;
};

const DEFAULT: DiscordSettings = {
  enabled: false,
  botTokenConfigured: false,
  channels: [],
  batchWindowMs: 0,
  batchMaxMessages: 12,
  alwaysRespondToMention: true,
  relevanceGateEnabled: true,
  autoJoinVoice: true,
  voiceBargeInEnabled: true,
  voiceInterruptAnnoyanceThreshold: 3,
  mentionsOnlyMode: false,
};

export function DiscordPanel(props: { moduleAvailable: boolean }) {
  const [settings, setSettings] = useState<DiscordSettings>(DEFAULT);
  const [botToken, setBotToken] = useState("");
  const [newChannelId, setNewChannelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [moduleStatus, setModuleStatus] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/discord/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { settings: DiscordSettings };
      setSettings({ ...DEFAULT, ...body.settings });
      setModuleStatus((body.moduleStatus as Record<string, unknown>) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = { ...settings };
      if (botToken.trim()) payload.botToken = botToken.trim();
      const res = await fetch("/api/v1/discord/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { settings: DiscordSettings };
      setSettings({ ...DEFAULT, ...body.settings });
      setBotToken("");
      setSaved(true);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addChannel = () => {
    const id = newChannelId.trim();
    if (!id) return;
    if (settings.channels.some((c) => c.channelId === id)) return;
    setSettings((s) => ({
      ...s,
      channels: [...s.channels, { channelId: id, enabled: true, textEnabled: true, voiceEnabled: false }],
    }));
    setNewChannelId("");
  };

  if (loading) return <p className="muted">Loading Discord settings…</p>;

  return (
    <section className="panel discord-panel">
      <div className="panel-head">
        <h2>Discord</h2>
        <span className={props.moduleAvailable ? "badge badge-ok" : "badge badge-off"}>
          {props.moduleAvailable ? "module connected" : "module offline — run pnpm dev:discord"}
        </span>
      </div>

      <p className="muted chat-hint">
        Text messages are batched and gated by persona before calling the LLM. Voice joins configured channels;
        STT/TTS modules will plug into the same pipeline (see docs/DISCORD.md).
      </p>

      <div className="banner discord-intent-hint">
        <strong>Developer Portal:</strong> Bot → Privileged Gateway Intents → enable{" "}
        <span className="mono">Message Content Intent</span> (needed to read normal channel chat). Save there first,
        then save here. If you see &quot;Used disallowed intents&quot;, that intent is still off or mentions-only mode
        is required.
      </div>

      {error && <div className="banner banner-warn">{error}</div>}
      {saved && <div className="banner banner-ok">Settings saved. Gateway connect runs in the Discord module (may take a few seconds).</div>}

      {moduleStatus && (
        <p className="muted mono discord-gateway-status">
          Bot gateway:{" "}
          {String(
            moduleStatus.gatewayStatus ??
              (moduleStatus.loggedIn ? "online" : props.moduleAvailable ? "offline" : "module offline"),
          )}
          {moduleStatus.lastGatewayError ? ` — ${String(moduleStatus.lastGatewayError)}` : ""}
        </p>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
        />
        Enable Discord integration
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.mentionsOnlyMode}
          onChange={(e) => setSettings((s) => ({ ...s, mentionsOnlyMode: e.target.checked }))}
        />
        Mentions only mode (no Message Content intent — bot only sees @mentions and replies)
      </label>

      <div className="form-grid">
        <label>
          Bot token {settings.botTokenConfigured && !botToken ? "(configured)" : ""}
          <input
            type="password"
            className="text-input"
            placeholder={settings.botTokenConfigured ? "Leave blank to keep current token" : "Discord bot token"}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Guild ID
          <input
            className="text-input mono"
            value={settings.guildId ?? ""}
            onChange={(e) => setSettings((s) => ({ ...s, guildId: e.target.value || undefined }))}
            placeholder="Snowflake guild id"
          />
        </label>
      </div>

      <h3>Channels</h3>
      <p className="muted">Empty list = all channels in guild (not recommended). Add text/voice channel ids explicitly.</p>
      <ul className="discord-channel-list">
        {settings.channels.map((c) => (
          <li key={c.channelId} className="discord-channel-row">
            <span className="mono">{c.channelId}</span>
            <label>
              <input
                type="checkbox"
                checked={c.textEnabled}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    channels: s.channels.map((x) =>
                      x.channelId === c.channelId ? { ...x, textEnabled: e.target.checked } : x,
                    ),
                  }))
                }
              />
              text
            </label>
            <label>
              <input
                type="checkbox"
                checked={c.voiceEnabled}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    channels: s.channels.map((x) =>
                      x.channelId === c.channelId ? { ...x, voiceEnabled: e.target.checked } : x,
                    ),
                  }))
                }
              />
              voice
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  channels: s.channels.filter((x) => x.channelId !== c.channelId),
                }))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="speaker-row">
        <input
          className="text-input mono"
          placeholder="Channel snowflake id"
          value={newChannelId}
          onChange={(e) => setNewChannelId(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={addChannel}>
          Add channel
        </button>
      </div>

      <h3>Text behavior</h3>
      <p className="muted">
        Each message is gated individually. Context is one ordered transcript: up to three lines before the backlog,
        every user message since the persona last replied, and her replies when they fall in that window (backlog cap
        below).
      </p>
      <div className="form-grid">
        <label>
          Max backlog since last reply
          <input
            type="number"
            className="text-input"
            min={1}
            max={50}
            value={settings.batchMaxMessages}
            onChange={(e) => setSettings((s) => ({ ...s, batchMaxMessages: Number(e.target.value) }))}
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.relevanceGateEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, relevanceGateEnabled: e.target.checked }))}
        />
        Persona relevance gate (skip messages the character would ignore)
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.alwaysRespondToMention}
          onChange={(e) => setSettings((s) => ({ ...s, alwaysRespondToMention: e.target.checked }))}
        />
        Always respond when @mentioned or replied to
      </label>

      <h3>Voice</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.autoJoinVoice}
          onChange={(e) => setSettings((s) => ({ ...s, autoJoinVoice: e.target.checked }))}
        />
        Auto-join voice when someone enters a voice-enabled channel
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.voiceBargeInEnabled}
          onChange={(e) => setSettings((s) => ({ ...s, voiceBargeInEnabled: e.target.checked }))}
        />
        Stop speaking when a human talks (never talk over people)
      </label>
      <label>
        Interrupt annoyance threshold
        <input
          type="number"
          className="text-input"
          min={1}
          max={20}
          value={settings.voiceInterruptAnnoyanceThreshold}
          onChange={(e) =>
            setSettings((s) => ({ ...s, voiceInterruptAnnoyanceThreshold: Number(e.target.value) }))
          }
        />
      </label>

      <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save Discord settings"}
      </button>
    </section>
  );
}
