import { useCallback, useEffect, useState } from "react";

type MemoryItem = {
  id: string;
  kind: string;
  scope?: string;
  summary: string | null;
  lifecycleState: string;
  confidence: number;
  importance: number;
  version: number;
  updatedAt: string;
  subject?: { key: string; displayName: string } | null;
};

type MemoryDetail = {
  id: string;
  content: string;
  summary: string | null;
  version: number;
  lifecycleState: string;
  scope?: string;
};

type BackgroundJob = {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  scheduledAt: string;
  lastError?: string | null;
};

const LIFECYCLE_OPTIONS = ["", "candidate", "active", "superseded"] as const;
const SCOPE_OPTIONS = ["", "participant", "social", "general"] as const;
const KIND_OPTIONS = ["", "semantic", "episodic"] as const;

export function MemoryPanel(props: { memoryAvailable: boolean; activeCharacterId: string | null }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("");
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [selected, setSelected] = useState<MemoryDetail | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memoryModules, setMemoryModules] = useState<{ moduleId: string; name: string }[]>([]);
  const [transferSource, setTransferSource] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferIncludeConv, setTransferIncludeConv] = useState(false);
  const [transferResult, setTransferResult] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  const loadModules = useCallback(async () => {
    if (!props.memoryAvailable) return;
    try {
      const res = await fetch("/api/v1/memory/modules");
      if (!res.ok) return;
      const data = (await res.json()) as { modules: { moduleId: string; name: string }[] };
      setMemoryModules(data.modules ?? []);
    } catch {
      /* non-fatal */
    }
  }, [props.memoryAvailable]);

  const loadJobs = useCallback(async () => {
    if (!props.memoryAvailable) return;
    try {
      const res = await fetch("/api/v1/memory/jobs");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: BackgroundJob[] };
      setJobs(data.jobs ?? []);
    } catch {
      /* non-fatal */
    }
  }, [props.memoryAvailable]);

  const load = useCallback(async () => {
    if (!props.memoryAvailable) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (props.activeCharacterId) params.set("personaId", props.activeCharacterId);
      if (lifecycleFilter) params.set("lifecycleState", lifecycleFilter);
      if (scopeFilter) params.set("scope", scopeFilter);
      if (kindFilter) params.set("kind", kindFilter);
      const res = await fetch(`/api/v1/memory/search?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? "Search failed");
      const data = (await res.json()) as { items: MemoryItem[] };
      setItems(data.items);
      void loadJobs();
      void loadModules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [
    props.memoryAvailable,
    props.activeCharacterId,
    query,
    lifecycleFilter,
    scopeFilter,
    kindFilter,
    loadJobs,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openItem(id: string) {
    const q = props.activeCharacterId ? `?personaId=${props.activeCharacterId}` : "";
    const res = await fetch(`/api/v1/memory/${id}${q}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      memory: {
        id: string;
        content: string;
        summary: string | null;
        version: number;
        lifecycleState: string;
        scope?: string;
      };
    };
    const m = data.memory;
    setSelected({
      id,
      content: m.content,
      summary: m.summary,
      version: m.version,
      lifecycleState: m.lifecycleState,
      scope: m.scope,
    });
    setEditContent(m.content);
    setEditSummary(m.summary ?? "");
  }

  async function saveEdits() {
    if (!selected || !props.activeCharacterId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/memory/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: props.activeCharacterId,
          expectedVersion: selected.version,
          content: editContent,
          summary: editSummary || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const body = (await res.json()) as { version: number };
      setSelected({ ...selected, content: editContent, summary: editSummary, version: body.version });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function promoteSelected() {
    if (!selected || !props.activeCharacterId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/memory/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: props.activeCharacterId,
          expectedVersion: selected.version,
          lifecycleState: "active",
        }),
      });
      if (!res.ok) throw new Error("Promote failed");
      setSelected(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promote failed");
    } finally {
      setSaving(false);
    }
  }

  async function pruneItem(id: string, version: number) {
    if (!confirm("Remove this memory from the persona? Search indexes and embeddings will be cleared.")) return;
    const res = await fetch(`/api/v1/memory/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version, personaId: props.activeCharacterId }),
    });
    if (!res.ok) {
      setError("Delete failed");
      return;
    }
    setSelected(null);
    void load();
  }

  async function runTransfer(dryRun: boolean) {
    if (!transferSource || !transferTarget || transferSource === transferTarget) {
      setError("Pick different source and target memory modules");
      return;
    }
    setTransferBusy(true);
    setTransferResult(null);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceModuleId: transferSource,
          targetModuleId: transferTarget,
          personaIds: props.activeCharacterId ? [props.activeCharacterId] : undefined,
          includeConversations: transferIncludeConv,
          mode: "merge",
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Transfer failed");
      setTransferResult(JSON.stringify(data, null, 2));
      if (!dryRun) void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setTransferBusy(false);
    }
  }

  const failedJobs = jobs.filter((j) => j.status === "failed" || (j.status === "pending" && j.attempts > 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Memory</h2>
        {!props.memoryAvailable && <span className="muted">Requires memory module</span>}
      </div>

      {!props.memoryAvailable && (
        <p className="muted">
          Start PostgreSQL (<span className="mono">docker compose up -d postgres</span>), migrate, then{" "}
          <span className="mono">pnpm dev:memory</span>.
        </p>
      )}

      {props.memoryAvailable && (
        <>
          <p className="muted chat-hint">
            Memories are captured automatically after chat. Filter candidates, promote or correct them, or prune what
            the persona should forget.
          </p>

          {memoryModules.length >= 2 && (
            <div className="panel memory-transfer">
              <h3>Migrate / merge (two memory modules)</h3>
              <p className="muted chat-hint">
                Connect source and target modules to this controller with different{" "}
                <span className="mono">ECHO_MEMORY_MODULE_ID</span> values. Chat uses{" "}
                <span className="mono">memory.primaryModuleId</span> in config.
              </p>
              <div className="memory-filters">
                <select
                  className="chat-input"
                  value={transferSource}
                  onChange={(e) => setTransferSource(e.target.value)}
                  aria-label="Source module"
                >
                  <option value="">Source module</option>
                  {memoryModules.map((m) => (
                    <option key={m.moduleId} value={m.moduleId}>
                      {m.name} ({m.moduleId})
                    </option>
                  ))}
                </select>
                <select
                  className="chat-input"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  aria-label="Target module"
                >
                  <option value="">Target module</option>
                  {memoryModules.map((m) => (
                    <option key={m.moduleId} value={m.moduleId}>
                      {m.name} ({m.moduleId})
                    </option>
                  ))}
                </select>
              </div>
              <label className="memory-edit-label">
                <input
                  type="checkbox"
                  checked={transferIncludeConv}
                  onChange={(e) => setTransferIncludeConv(e.target.checked)}
                />{" "}
                Include conversation history (large)
              </label>
              <div className="memory-detail-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={transferBusy}
                  onClick={() => void runTransfer(true)}
                >
                  Dry run
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={transferBusy}
                  onClick={() => {
                    if (
                      confirm(
                        "Merge exported data from source into target? Existing UUIDs will be upserted on the target database.",
                      )
                    ) {
                      void runTransfer(false);
                    }
                  }}
                >
                  Transfer merge
                </button>
              </div>
              {transferResult && (
                <pre className="memory-content memory-transfer-result">{transferResult}</pre>
              )}
            </div>
          )}

          <div className="memory-filters">
            <select
              className="chat-input"
              value={lifecycleFilter}
              onChange={(e) => setLifecycleFilter(e.target.value)}
              aria-label="Lifecycle filter"
            >
              <option value="">All lifecycles</option>
              {LIFECYCLE_OPTIONS.filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="chat-input"
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              aria-label="Scope filter"
            >
              <option value="">All scopes</option>
              {SCOPE_OPTIONS.filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="chat-input"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              aria-label="Kind filter"
            >
              <option value="">All kinds</option>
              {KIND_OPTIONS.filter(Boolean).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <form
            className="memory-search"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <input
              className="chat-input"
              placeholder="Search memories (full-text)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              Search
            </button>
          </form>

          {error && <div className="banner banner-warn">{error}</div>}

          {failedJobs.length > 0 && (
            <div className="banner banner-warn">
              <strong>Background jobs need attention</strong>
              <ul className="memory-job-list">
                {failedJobs.slice(0, 5).map((j) => (
                  <li key={j.id} className="mono">
                    {j.jobType} · {j.status} · attempts {j.attempts}
                    {j.lastError ? ` — ${j.lastError.slice(0, 120)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="memory-list">
            {items.map((item) => (
              <li key={item.id} className="memory-row">
                <button type="button" className="memory-select" onClick={() => void openItem(item.id)}>
                  <strong>{item.summary ?? item.id.slice(0, 8)}</strong>
                  <span className="muted mono">
                    {item.subject?.displayName ? `${item.subject.displayName} · ` : "No speaker · "}
                    {item.scope ?? "?"} · {item.kind} · {item.lifecycleState} · v{item.version}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-ghost danger"
                  onClick={() => void pruneItem(item.id, item.version)}
                >
                  Prune
                </button>
              </li>
            ))}
            {!items.length && !loading && <li className="muted">No memories match filters.</li>}
          </ul>

          {selected && (
            <div className="panel memory-detail">
              <h3>Memory detail</h3>
              <p className="muted mono">
                {selected.scope ?? "?"} · {selected.lifecycleState} · v{selected.version}
              </p>
              <label className="memory-edit-label">
                Summary
                <input
                  className="chat-input"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </label>
              <label className="memory-edit-label">
                Content
                <textarea
                  className="chat-input memory-edit-area"
                  rows={8}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              </label>
              <div className="memory-detail-actions">
                <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveEdits()}>
                  Save correction
                </button>
                {selected.lifecycleState === "candidate" && (
                  <button type="button" className="btn-ghost" disabled={saving} onClick={() => void promoteSelected()}>
                    Promote to active
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost danger"
                  onClick={() => void pruneItem(selected.id, selected.version)}
                >
                  Prune
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
