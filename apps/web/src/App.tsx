import { useState } from "react";
import { useDashboardSocket } from "./hooks/useDashboardSocket";
import { ChatPanel } from "./components/ChatPanel";
import { LlmSettingsPanel } from "./components/LlmSettingsPanel";
import { CharactersPanel } from "./components/CharactersPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { DiscordPanel } from "./components/DiscordPanel";
import { VoicePanel } from "./components/VoicePanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { EventsPanel } from "./components/EventsPanel";
import { ModulesPanel } from "./components/ModulesPanel";
import type { AppView } from "./types";

type NavItem = { id: AppView; label: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "Core",
    items: [
      { id: "overview", label: "Overview" },
      { id: "events", label: "Events" },
      { id: "chat", label: "Chat" },
    ],
  },
  {
    label: "Cognition",
    items: [
      { id: "llm", label: "LLM" },
      { id: "characters", label: "Characters" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    label: "Voice & I/O",
    items: [
      { id: "voice", label: "Voice" },
      { id: "discord", label: "Discord" },
    ],
  },
  {
    label: "System",
    items: [{ id: "modules", label: "Modules" }],
  },
];

const PAGE_COPY: Record<
  AppView,
  { title: string; subtitle: string }
> = {
  overview: { title: "Overview", subtitle: "Persona status, services, and recent activity" },
  events: {
    title: "Events",
    subtitle: "Persistent system log with filters and pagination",
  },
  chat: { title: "Chat", subtitle: "Talk to the active character from the dashboard" },
  llm: { title: "LLM", subtitle: "Providers, models, and generation defaults" },
  characters: { title: "Character cards", subtitle: "Personas for the LLM — one active at a time" },
  memory: { title: "Memory", subtitle: "Search and curate persistent memories" },
  voice: { title: "Voice", subtitle: "STT and TTS modules for Discord and future Twitch/STT sources" },
  discord: { title: "Discord", subtitle: "Bot connection, channels, text batching, and voice policies" },
  modules: { title: "Modules", subtitle: "Registered module processes and capabilities" },
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function App() {
  const { snapshot, liveEvent, connection, error } = useDashboardSocket();
  const moduleIds = [...new Set((snapshot?.modules.modules ?? []).map((m) => m.moduleId))].sort();
  const [view, setView] = useState<AppView>("overview");

  const persona = snapshot?.persona;
  const modules = snapshot?.modules.modules ?? [];
  const llmAvailable = snapshot?.llm.moduleAvailable ?? false;
  const memoryAvailable = snapshot?.memory.moduleAvailable ?? false;
  const discordAvailable = snapshot?.discord?.moduleAvailable ?? false;
  const sttAvailable = snapshot?.stt?.moduleAvailable ?? false;
  const ttsAvailable = snapshot?.tts?.moduleAvailable ?? false;
  const activeCharacterId = snapshot?.character.activeCharacterId ?? persona?.activeCharacterId ?? null;
  const page = PAGE_COPY[view];

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
          {NAV.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item nav-btn ${view === item.id ? "active" : ""}`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <footer className="sidebar-foot">
          <span className={`conn-dot conn-${connection}`} />
          Dashboard {connection}
        </footer>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{page.title}</h1>
            <p className="muted">{page.subtitle}</p>
          </div>
          {snapshot && (
            <div className="topbar-stats mono">
              <span>{snapshot.controllerId}</span>
              <span>uptime {formatUptime(snapshot.uptimeSeconds)}</span>
            </div>
          )}
        </header>

        {error && <div className="banner banner-warn">{error}</div>}

        {view === "overview" && <OverviewPanel snapshot={snapshot} />}

        {view === "events" && <EventsPanel liveEvent={liveEvent} moduleIds={moduleIds} />}

        {view === "chat" && (
          <ChatPanel
            llmModuleAvailable={llmAvailable}
            memoryModuleAvailable={memoryAvailable}
            llmAdapter={snapshot?.llm.adapter}
            activeModel={persona?.activeModel ?? null}
            activeCharacterId={activeCharacterId}
            characterName={snapshot?.character.activeCharacterName ?? persona?.name ?? "Character"}
          />
        )}

        {view === "llm" && <LlmSettingsPanel moduleAvailable={llmAvailable} />}

        {view === "characters" && <CharactersPanel activeCharacterId={activeCharacterId} />}

        {view === "memory" && (
          <MemoryPanel
            memoryAvailable={memoryAvailable}
            activeCharacterId={activeCharacterId}
            characterName={snapshot?.character.activeCharacterName ?? persona?.name ?? "Character"}
          />
        )}

        {view === "voice" && <VoicePanel sttAvailable={sttAvailable} ttsAvailable={ttsAvailable} />}

        {view === "discord" && <DiscordPanel moduleAvailable={discordAvailable} />}

        {view === "modules" && (
          <ModulesPanel modules={modules} updatedAt={snapshot?.modules.updatedAt} />
        )}
      </main>
    </div>
  );
}
