import { useCallback, useEffect, useState } from "react";

type CharacterSummary = {
  id: string;
  name: string;
  tagline?: string;
  updatedAt: string;
};

type CharacterCard = CharacterSummary & {
  summary?: string;
  personality?: string;
  mannerisms?: string;
  speechStyle?: string;
  physicalAppearance?: string;
  background?: string;
  behavioralRules?: string;
  referenceImages: { id: string; url?: string; caption?: string; description?: string }[];
};

const emptyDraft = (): Omit<CharacterCard, "id" | "updatedAt"> & { id?: string } => ({
  name: "",
  tagline: "",
  summary: "",
  personality: "",
  mannerisms: "",
  speechStyle: "",
  physicalAppearance: "",
  background: "",
  behavioralRules: "",
  referenceImages: [],
});

export function CharactersPanel(props: {
  activeCharacterId: string | null;
  onActiveChange?: () => void;
}) {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(props.activeCharacterId);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/v1/characters");
    if (!res.ok) return;
    const data = (await res.json()) as { characters: CharacterSummary[]; activeCharacterId: string | null };
    setCharacters(data.characters);
    setActiveId(data.activeCharacterId);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, props.activeCharacterId]);

  async function loadCard(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/characters/${id}`);
      if (!res.ok) throw new Error("Failed to load character");
      const data = (await res.json()) as { character: CharacterCard };
      setDraft(data.character);
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveCard() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const body = {
        name: draft.name,
        tagline: draft.tagline || undefined,
        summary: draft.summary || undefined,
        personality: draft.personality || undefined,
        mannerisms: draft.mannerisms || undefined,
        speechStyle: draft.speechStyle || undefined,
        physicalAppearance: draft.physicalAppearance || undefined,
        background: draft.background || undefined,
        behavioralRules: draft.behavioralRules || undefined,
        referenceImages: draft.referenceImages,
      };
      const res =
        selectedId === "new" || !selectedId
          ? await fetch("/api/v1/characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          : await fetch(`/api/v1/characters/${selectedId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { character: CharacterCard };
      setSelectedId(data.character.id);
      setDraft(data.character);
      setSaved(true);
      await loadList();
      props.onActiveChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function activate(id: string) {
    const res = await fetch("/api/v1/characters/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: id }),
    });
    if (res.ok) {
      setActiveId(id);
      await loadList();
      props.onActiveChange?.();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this character card?")) return;
    await fetch(`/api/v1/characters/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setSelectedId(null);
      setDraft(emptyDraft());
    }
    await loadList();
    props.onActiveChange?.();
  }

  function addReferenceImage() {
    setDraft({
      ...draft,
      referenceImages: [
        ...draft.referenceImages,
        { id: crypto.randomUUID(), caption: "", description: "", url: "" },
      ],
    });
  }

  return (
    <div className="characters-layout">
      <section className="panel characters-list-panel">
        <div className="panel-head">
          <h2>Character cards</h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSelectedId("new");
              setDraft(emptyDraft());
            }}
          >
            New
          </button>
        </div>
        <ul className="character-list">
          {characters.map((c) => (
            <li key={c.id} className={c.id === activeId ? "character-row active" : "character-row"}>
              <button type="button" className="character-select" onClick={() => void loadCard(c.id)}>
                <strong>{c.name}</strong>
                {c.tagline && <span className="muted">{c.tagline}</span>}
              </button>
              <div className="character-actions">
                {c.id !== activeId ? (
                  <button type="button" className="btn-ghost" onClick={() => void activate(c.id)}>
                    Activate
                  </button>
                ) : (
                  <span className="badge badge-ok">Active</span>
                )}
              </div>
            </li>
          ))}
          {characters.length === 0 && <li className="muted">No characters yet — create one.</li>}
        </ul>
      </section>

      <section className="panel characters-editor-panel">
        <div className="panel-head">
          <h2>{selectedId === "new" ? "New character" : draft.name || "Editor"}</h2>
          {saved && <span className="badge badge-ok">Saved</span>}
        </div>

        {!selectedId && <p className="muted">Select a character or create a new card.</p>}

        {selectedId && (
          <div className="character-form">
            <label className="field">
              <span>Name</span>
              <input className="text-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input className="text-input" value={draft.tagline ?? ""} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
            </label>
            <label className="field">
              <span>Identity summary</span>
              <textarea className="chat-input" rows={3} value={draft.summary ?? ""} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
            </label>
            <label className="field">
              <span>Personality</span>
              <textarea className="chat-input" rows={3} value={draft.personality ?? ""} onChange={(e) => setDraft({ ...draft, personality: e.target.value })} />
            </label>
            <label className="field">
              <span>Mannerisms</span>
              <textarea className="chat-input" rows={2} value={draft.mannerisms ?? ""} onChange={(e) => setDraft({ ...draft, mannerisms: e.target.value })} />
            </label>
            <label className="field">
              <span>Speech style</span>
              <textarea className="chat-input" rows={2} value={draft.speechStyle ?? ""} onChange={(e) => setDraft({ ...draft, speechStyle: e.target.value })} />
            </label>
            <label className="field">
              <span>Physical appearance</span>
              <textarea className="chat-input" rows={3} value={draft.physicalAppearance ?? ""} onChange={(e) => setDraft({ ...draft, physicalAppearance: e.target.value })} />
            </label>
            <label className="field">
              <span>Background</span>
              <textarea className="chat-input" rows={3} value={draft.background ?? ""} onChange={(e) => setDraft({ ...draft, background: e.target.value })} />
            </label>
            <label className="field">
              <span>Character rules</span>
              <textarea className="chat-input" rows={2} value={draft.behavioralRules ?? ""} onChange={(e) => setDraft({ ...draft, behavioralRules: e.target.value })} />
            </label>

            <div className="refs">
              <div className="panel-head">
                <h2>Reference images</h2>
                <button type="button" className="btn-ghost" onClick={addReferenceImage}>
                  Add
                </button>
              </div>
              <p className="muted chat-hint">URLs or paths for vision modules later; include captions and visual notes for the model.</p>
              {draft.referenceImages.map((img, idx) => (
                <div key={img.id} className="ref-block">
                  <input
                    className="text-input mono"
                    placeholder="Image URL or path"
                    value={img.url ?? ""}
                    onChange={(e) => {
                      const referenceImages = [...draft.referenceImages];
                      referenceImages[idx] = { ...img, url: e.target.value };
                      setDraft({ ...draft, referenceImages });
                    }}
                  />
                  <input
                    className="text-input"
                    placeholder="Caption"
                    value={img.caption ?? ""}
                    onChange={(e) => {
                      const referenceImages = [...draft.referenceImages];
                      referenceImages[idx] = { ...img, caption: e.target.value };
                      setDraft({ ...draft, referenceImages });
                    }}
                  />
                  <textarea
                    className="chat-input"
                    rows={2}
                    placeholder="Visual description"
                    value={img.description ?? ""}
                    onChange={(e) => {
                      const referenceImages = [...draft.referenceImages];
                      referenceImages[idx] = { ...img, description: e.target.value };
                      setDraft({ ...draft, referenceImages });
                    }}
                  />
                </div>
              ))}
            </div>

            {error && <div className="banner banner-warn">{error}</div>}

            <div className="form-actions">
              <button type="button" className="btn-primary" disabled={loading || !draft.name.trim()} onClick={() => void saveCard()}>
                Save card
              </button>
              {selectedId !== "new" && typeof selectedId === "string" && (
                <>
                  <button type="button" className="btn-ghost" onClick={() => void activate(selectedId)}>
                    Activate
                  </button>
                  <button type="button" className="btn-ghost danger" onClick={() => void remove(selectedId)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
