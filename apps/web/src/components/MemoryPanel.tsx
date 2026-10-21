import { useCallback, useEffect, useState } from "react";

type MemoryItem = {
  id: string;
  kind: string;
  summary: string | null;
  lifecycleState: string;
  confidence: number;
  importance: number;
  version: number;
  updatedAt: string;
  subject?: { key: string; displayName: string } | null;
};

export function MemoryPanel(props: { memoryAvailable: boolean; activeCharacterId: string | null }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ content: string; version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!props.memoryAvailable) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (props.activeCharacterId) params.set("personaId", props.activeCharacterId);
      const res = await fetch(`/api/v1/memory/search?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? "Search failed");
      const data = (await res.json()) as { items: MemoryItem[] };
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [props.memoryAvailable, props.activeCharacterId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openItem(id: string) {
    const res = await fetch(`/api/v1/memory/${id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { memory: { content: string; version: number } };
    setSelected({ content: data.memory.content, version: data.memory.version });
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
            Memories are captured automatically after chat. Use prune to forget something the persona should no longer
            use.
          </p>
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

          <ul className="memory-list">
            {items.map((item) => (
              <li key={item.id} className="memory-row">
                <button type="button" className="memory-select" onClick={() => void openItem(item.id)}>
                  <strong>{item.summary ?? item.id.slice(0, 8)}</strong>
                  <span className="muted mono">
                    {item.subject?.displayName ? `${item.subject.displayName} · ` : "No speaker · "}
                    {item.kind} · {item.lifecycleState} · v{item.version}
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
            {!items.length && !loading && <li className="muted">No memories yet.</li>}
          </ul>

          {selected && (
            <div className="panel memory-detail">
              <h3>Memory detail</h3>
              <pre className="memory-content">{selected.content}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
