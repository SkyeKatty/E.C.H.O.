import { useState } from "react";
import { useDashboardSocket } from "./hooks/useDashboardSocket";
import { ChatPanel } from "./components/ChatPanel";
import { LlmSettingsPanel } from "./components/LlmSettingsPanel";
import { CharactersPanel } from "./components/CharactersPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import type { ModuleRecord } from "./types";

type AppView = "dashboard" | "characters" | "memory";

function stateBadge(state: string): string {
  switch (state) {
    case "ready":
      return "badge badge-ok";
    case "busy":
      return "badge badge-warn";
    case "degraded":
      return "badge badge-warn";
    case "disconnected":
      return "badge badge-off";
    default:
      return "badge";
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ModuleCard({ module }: { module: ModuleRecord }) {
  return (
    <article className="module-card">
      <header className="module-card-header">
        <div>
          <h3>{module.name}</h3>
          <p className="muted mono">{module.moduleId}</p>
        </div>
        <span className={stateBadge(module.connectionState)}>{module.connectionState}</span>
      </header>
      <dl className="meta-grid">
        <div>
          <dt>Version</dt>
          <dd>{module.version}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd className="mono">{module.protocolVersion}</dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd>{module.healthStatus}</dd>
        </div>
        <div>
          <dt>Host</dt>
          <dd>{module.host?.hostname ?? "—"}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd className="mono">{module.lastHeartbeatAt ? new Date(module.lastHeartbeatAt).toLocaleTimeString() : "—"}</dd>
        </div>
      </dl>
      {module.capabilities.length > 0 && (
        <div className="caps">
          <span className="caps-label">Capabilities</span>
          <ul>
            {module.capabilities.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span>
                {!c.enabled && <span className="muted"> (disabled)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function App() {
  const { snapshot, connection, error } = useDashboardSocket();
  const [view, setView] = useState<AppView>("dashboard");

  const persona = snapshot?.persona;
  const modules = snapshot?.modules.modules ?? [];
  const llmAvailable = snapshot?.llm.moduleAvailable ?? false;
  const memoryAvailable = snapshot?.memory.moduleAvailable ?? false;
  const activeCharacterId = snapshot?.character.activeCharacterId ?? persona?.activeCharacterId ?? null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <strong>ECHO</strong>
            <span className="muted">Persona Runtime</span>
          </div>
        </div>
        <nav className="nav">
          <button type="button" className={`nav-item nav-btn ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button type="button" className={`nav-item nav-btn ${view === "characters" ? "active" : ""}`} onClick={() => setView("characters")}>
            Characters
          </button>
          <button type="button" className={`nav-item nav-btn ${view === "memory" ? "active" : ""}`} onClick={() => setView("memory")}>
            Memory
          </button>
        </nav>
        <footer className="sidebar-foot">
          <span className={`conn-dot conn-${connection}`} />
          Dashboard {connection}
        </footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>
              {view === "characters" ? "Character cards" : view === "memory" ? "Persistent memory" : "System overview"}
            </h1>
            <p className="muted">
              {view === "characters"
                ? "Personas for the LLM — one active character at a time"
                : view === "memory"
                  ? "Inspect, search, and delete stored memories for the active character"
                  : "Live status from the central controller"}
            </p>
          </div>
          {snapshot && (
            <div className="topbar-stats mono">
              <span>{snapshot.controllerId}</span>
              <span>uptime {formatUptime(snapshot.uptimeSeconds)}</span>
            </div>
          )}
        </header>

        {error && <div className="banner banner-warn">{error}</div>}

        {view === "characters" && <CharactersPanel activeCharacterId={activeCharacterId} />}

        {view === "memory" && (
          <MemoryPanel memoryAvailable={memoryAvailable} activeCharacterId={activeCharacterId} />
        )}

        {view === "dashboard" && (
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
            <h2>Modules</h2>
            <p className="stat-big">{modules.length}</p>
            <p className="muted">registered on this controller</p>
          </div>
        </section>

        <LlmSettingsPanel moduleAvailable={llmAvailable} />

        <ChatPanel
          llmModuleAvailable={llmAvailable}
          llmAdapter={snapshot?.llm.adapter}
          activeModel={persona?.activeModel ?? null}
          characterName={snapshot?.character.activeCharacterName ?? persona?.name ?? "Character"}
        />

        <section className="panel">
          <div className="panel-head">
            <h2>Connected modules</h2>
            {snapshot?.modules.updatedAt && (
              <span className="muted mono">updated {new Date(snapshot.modules.updatedAt).toLocaleTimeString()}</span>
            )}
          </div>
          {modules.length === 0 ? (
            <div className="empty">
              <p>No modules connected yet.</p>
              <p className="muted mono">pnpm dev:mock</p>
            </div>
          ) : (
            <div className="module-grid">
              {modules.map((m) => (
                <ModuleCard key={m.moduleId} module={m} />
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Recent events</h2>
          <ul className="event-list">
            {(snapshot?.recentEvents ?? []).slice(0, 12).map((e) => (
              <li key={e.id}>
                <time className="mono">{new Date(e.timestamp).toLocaleTimeString()}</time>
                <span className="event-type mono">{e.type}</span>
                <span>{e.summary}</span>
              </li>
            ))}
            {!snapshot?.recentEvents.length && <li className="muted">No events yet</li>}
          </ul>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
