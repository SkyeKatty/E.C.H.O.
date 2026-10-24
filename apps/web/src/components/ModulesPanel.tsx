import type { ModuleRecord } from "../types";

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
          <dd className="mono">
            {module.lastHeartbeatAt ? new Date(module.lastHeartbeatAt).toLocaleTimeString() : "—"}
          </dd>
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

export function ModulesPanel(props: { modules: ModuleRecord[]; updatedAt?: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Connected modules</h2>
        {props.updatedAt && (
          <span className="muted mono">updated {new Date(props.updatedAt).toLocaleTimeString()}</span>
        )}
      </div>
      {props.modules.length === 0 ? (
        <div className="empty">
          <p>No modules connected yet.</p>
          <p className="muted mono">pnpm dev:llm · dev:memory · dev:discord · dev:stt · dev:tts</p>
        </div>
      ) : (
        <div className="module-grid">
          {props.modules.map((m) => (
            <ModuleCard key={m.moduleId} module={m} />
          ))}
        </div>
      )}
    </section>
  );
}
