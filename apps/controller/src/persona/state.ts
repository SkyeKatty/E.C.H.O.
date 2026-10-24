import type { SystemEvent } from "./event-log.js";

export type PersonaOperationalState = {
  name: string;
  activeCharacterId: string | null;
  activity: string;
  focus: string;
  channel: string;
  reactiveOnly: boolean;
  processingPaused: boolean;
  autonomyEnabled: boolean;
  activeModel: string | null;
  activeProvider: string | null;
  pendingActions: number;
  lastEventSummary: string | null;
};

export function createInitialPersonaState(input: {
  name: string;
  activeCharacterId?: string | null;
  reactiveOnly: boolean;
}): PersonaOperationalState {
  return {
    name: input.name,
    activeCharacterId: input.activeCharacterId ?? null,
    activity: "idle",
    focus: "awaiting input",
    channel: "dashboard",
    reactiveOnly: input.reactiveOnly,
    processingPaused: false,
    autonomyEnabled: !input.reactiveOnly,
    activeModel: null,
    activeProvider: null,
    pendingActions: 0,
    lastEventSummary: null,
  };
}

export type SystemSnapshot = {
  controllerId: string;
  uptimeSeconds: number;
  persona: PersonaOperationalState;
  modules: import("../registry/module-registry.js").ModuleRegistrySnapshot;
  llm: {
    moduleAvailable: boolean;
    adapter: "module" | "embedded";
    moduleId: string | null;
  };
  memory: {
    moduleAvailable: boolean;
    moduleId: string | null;
    primaryModuleId?: string | null;
    connectedModules?: number;
  };
  discord?: {
    moduleAvailable: boolean;
    moduleId: string | null;
    enabled: boolean;
  };
  timekeeping?: {
    moduleAvailable: boolean;
    moduleId: string | null;
  };
  tts?: {
    moduleAvailable: boolean;
    moduleId: string | null;
  };
  stt?: {
    moduleAvailable: boolean;
    moduleId: string | null;
  };
  character: {
    activeCharacterId: string | null;
    activeCharacterName: string | null;
  };
  recentEvents: SystemEvent[];
};

export type { SystemEvent } from "./event-log.js";
export { EventLog, eventSeverityForType } from "./event-log.js";
