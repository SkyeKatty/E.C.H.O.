import type { ModuleRecord, SystemSnapshot } from "../types";
import { eventSeverity } from "../lib/events";

function moduleOffersCapability(modules: ModuleRecord[], capabilityId: string): boolean {
  return modules.some(
    (m) =>
      m.connectionState !== "disconnected" &&
      m.capabilities.some((c) => c.id === capabilityId && c.enabled),
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function OverviewPanel(props: { snapshot: SystemSnapshot | null }) {
  const snapshot = props.snapshot;
  const persona = snapshot?.persona;
  const modules = snapshot?.modules.modules ?? [];

  const services = [
    { label: "LLM", ok: snapshot?.llm.moduleAvailable },
    { label: "Memory", ok: snapshot?.memory.moduleAvailable },
    { label: "Discord", ok: snapshot?.discord?.moduleAvailable },
    { label: "STT", ok: snapshot?.stt?.moduleAvailable },
    { label: "TTS", ok: snapshot?.tts?.moduleAvailable },
    {
      label: "Time",
      ok:
        snapshot?.timekeeping?.moduleAvailable ||
        moduleOffersCapability(modules, "time.now.get") ||
        moduleOffersCapability(modules, "time.health.get"),
    },
  ];

  return (
    <>
      <section className="grid persona-grid">
        <div className="panel">
          <h2>Persona</h2>
          {persona ? (
            <dl className="meta-grid">
              <div>
                <dt>Character</dt>
                <dd>{snapshot?.character.activeCharacterName ?? persona.name}</dd>
              </div>
              <div>
                <dt>Activity</dt>
                <dd>{persona.activity}</dd>
              </div>
              <div>
                <dt>Focus</dt>
                <dd>{persona.focus}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{persona.reactiveOnly ? "Reactive only" : "Autonomy enabled"}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd className="mono">{persona.activeProvider ?? "—"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="mono">{persona.activeModel ?? "Not configured"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Connecting…</p>
          )}
        </div>

        <div className="panel">
          <h2>Runtime</h2>
          {snapshot ? (
            <dl className="meta-grid">
              <div>
                <dt>Controller</dt>
                <dd className="mono">{snapshot.controllerId}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{formatUptime(snapshot.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt>Modules</dt>
                <dd>{modules.length} connected</dd>
              </div>
              <div>
                <dt>Discord</dt>
                <dd>{snapshot.discord?.enabled ? "enabled" : "disabled"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Connecting…</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Services</h2>
        <ul className="service-status-list">
          {services.map((s) => (
            <li key={s.label}>
              <span className={s.ok ? "badge badge-ok" : "badge badge-off"}>{s.ok ? "up" : "down"}</span>
              {s.label}
            </li>
          ))}
        </ul>
        <p className="muted chat-hint">
          Configure LLM, voice, and Discord from the sidebar. Use <span className="mono">Chat</span> for dashboard
          conversations.
        </p>
      </section>

      <section className="panel">
        <h2>Recent events</h2>
        <p className="muted chat-hint">Latest activity only — open the Events tab for the full persisted log.</p>
        <ul className="event-list">
          {(snapshot?.recentEvents ?? []).slice(0, 32).map((e) => (
            <li key={e.id} className={`event-severity-${eventSeverity(e.type)}`}>
              <time className="mono">{new Date(e.timestamp).toLocaleTimeString()}</time>
              <span className="event-type mono">{e.type}</span>
              {e.moduleId ? <span className="event-module mono">{e.moduleId}</span> : null}
              <span className="event-summary">{e.summary}</span>
            </li>
          ))}
          {!snapshot?.recentEvents.length && <li className="muted">No events yet</li>}
        </ul>
      </section>
    </>
  );
}
