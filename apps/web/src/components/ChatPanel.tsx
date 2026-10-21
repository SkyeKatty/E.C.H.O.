import { useCallback, useEffect, useRef, useState } from "react";
import { loadDashboardParticipant, saveDashboardDisplayName } from "../lib/participant";
import { ensureChatSessionId, saveChatSessionId } from "../lib/chatSession";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  speakerName?: string;
};

export function ChatPanel(props: {
  llmModuleAvailable: boolean;
  memoryModuleAvailable?: boolean;
  llmAdapter?: "module" | "embedded";
  activeModel: string | null;
  activeCharacterId: string | null;
  characterName: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<number | null>(null);
  const [speakerName, setSpeakerName] = useState(() => loadDashboardParticipant().displayName);
  const [speaker, setSpeaker] = useState(() => loadDashboardParticipant());
  const listRef = useRef<HTMLDivElement>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const characterId = props.activeCharacterId;
    if (!characterId) return;

    const sid = ensureChatSessionId(characterId);
    setSessionId(sid);

    if (!props.memoryModuleAvailable) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/chat/history?sessionId=${encodeURIComponent(sid)}`,
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          messages?: {
            id: string;
            role: string;
            content: string | null;
            speakerDisplayName?: string | null;
          }[];
        };
        if (cancelled || !body.messages?.length) return;
        setMessages(
          body.messages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content ?? "",
            speakerName: m.role === "user" ? m.speakerDisplayName ?? undefined : undefined,
          })),
        );
      } catch {
        /* history optional when memory module is offline */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.activeCharacterId, props.memoryModuleAvailable]);

  const cancelTask = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    fetchAbortRef.current?.abort();
    if (taskId) {
      try {
        await fetch(`/api/v1/chat/cancel/${taskId}`, { method: "POST" });
      } catch {
        /* best-effort */
      }
    }
    setLoading(false);
    activeTaskIdRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || loading || !props.llmModuleAvailable) return;

      setError(null);
      setInput("");
      const activeSpeaker = saveDashboardDisplayName(speakerName);
      setSpeaker(activeSpeaker);
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        speakerName: activeSpeaker.displayName,
      };
      setMessages((m) => [...m, userMsg]);

      const assistantId = crypto.randomUUID();
      setMessages((m) => [...m, { id: assistantId, role: "assistant", content: "" }]);

      const taskId = crypto.randomUUID();
      activeTaskIdRef.current = taskId;
      const fetchAbort = new AbortController();
      fetchAbortRef.current = fetchAbort;
      setLoading(true);

      try {
        const res = await fetch("/api/v1/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: fetchAbort.signal,
          body: JSON.stringify({
            message: text,
            sessionId,
            taskId,
            speaker: activeSpeaker,
            stream: true,
          }),
        });

        if (!res.ok || !res.body) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.split("\n");
            let event = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              if (line.startsWith("data:")) data = line.slice(5).trim();
            }
            if (!data) continue;
            const payload = JSON.parse(data) as Record<string, unknown>;

            if (event === "started" && typeof payload.sessionId === "string") {
              setSessionId(payload.sessionId);
              if (props.activeCharacterId) {
                saveChatSessionId(props.activeCharacterId, payload.sessionId);
              }
            }
            if (event === "delta" && typeof payload.delta === "string") {
              setMessages((msgs) =>
                msgs.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + payload.delta } : m,
                ),
              );
            }
            if (event === "done") {
              if (typeof payload.sessionId === "string") {
                setSessionId(payload.sessionId);
                if (props.activeCharacterId) {
                  saveChatSessionId(props.activeCharacterId, payload.sessionId);
                }
              }
              const usage = payload.usage as { totalTokens?: number } | undefined;
              if (usage?.totalTokens != null) setLastUsage(usage.totalTokens);
            }
            if (event === "error") {
              const aborted = payload.aborted === true;
              throw new Error(aborted ? "Request cancelled" : String(payload.message ?? "Stream error"));
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Request cancelled");
        } else {
          setError(err instanceof Error ? err.message : "Chat failed");
        }
        setMessages((msgs) => msgs.filter((m) => m.id !== assistantId || m.content.length > 0));
      } finally {
        setLoading(false);
        activeTaskIdRef.current = null;
        fetchAbortRef.current = null;
      }
    },
    [input, loading, props.llmModuleAvailable, sessionId, speakerName],
  );

  return (
    <section className="panel chat-panel">
      <div className="panel-head">
        <h2>Conversation</h2>
        <div className="chat-controls">
          {!props.llmModuleAvailable ? (
            <span className="muted">Requires LLM backend</span>
          ) : (
            <span className="muted mono">{props.activeModel ?? "model not set"}</span>
          )}
          {lastUsage != null && !loading && (
            <span className="muted mono">last turn: {lastUsage} tokens</span>
          )}
        </div>
      </div>

      {!props.llmModuleAvailable && (
        <p className="muted chat-hint">
          Start the LLM backend: <span className="mono">pnpm dev:llm</span> or set{" "}
          <span className="mono">cognition.llmAdapter: embedded</span> in config.
        </p>
      )}

      <div className="chat-log" ref={listRef}>
        {messages.length === 0 && (
          <p className="muted empty-chat">
            {props.llmModuleAvailable
              ? `Send a message to talk with ${props.activeModel ?? "the persona"}.`
              : "LLM backend offline."}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble chat-${m.role}`}>
            <span className="chat-role">
              {m.role === "user" ? (m.speakerName ?? speaker.displayName) : props.characterName}
            </span>
            <div className="chat-content">{m.content || (loading && m.role === "assistant" ? "…" : "")}</div>
          </div>
        ))}
      </div>

      {error && <div className="banner banner-warn">{error}</div>}

      <div className="speaker-row">
        <label className="muted" htmlFor="speaker-name">
          Speaking as
        </label>
        <input
          id="speaker-name"
          className="speaker-input"
          value={speakerName}
          onChange={(e) => setSpeakerName(e.target.value)}
          onBlur={() => setSpeaker(saveDashboardDisplayName(speakerName))}
          placeholder="Your name (for memory attribution)"
          disabled={loading}
        />
        <span className="muted mono speaker-key" title="Stable id for this browser">
          {speaker.key}
        </span>
      </div>

      <form className="chat-form" onSubmit={(e) => void sendMessage(e)}>
        <textarea
          className="chat-input"
          rows={2}
          placeholder={props.llmModuleAvailable ? "Message the persona…" : "Start LLM backend to chat"}
          value={input}
          disabled={!props.llmModuleAvailable || loading}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              void sendMessage(ev);
            }
          }}
        />
        {loading ? (
          <button type="button" className="btn-stop" onClick={() => void cancelTask()}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn-primary"
            disabled={!props.llmModuleAvailable || !input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
