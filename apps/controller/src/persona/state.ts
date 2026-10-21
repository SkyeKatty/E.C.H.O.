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
  character: {
    activeCharacterId: string | null;
    activeCharacterName: string | null;
  };
  recentEvents: SystemEvent[];
};

export type SystemEvent = {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  moduleId?: string;
};

export class EventLog {
  private events: SystemEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  append(event: Omit<SystemEvent, "id" | "timestamp"> & { timestamp?: string }): SystemEvent {
    const record: SystemEvent = {
      id: crypto.randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      summary: event.summary,
      moduleId: event.moduleId,
    };
    this.events.unshift(record);
    if (this.events.length > this.maxSize) {
      this.events.length = this.maxSize;
    }
    return record;
  }

  list(): SystemEvent[] {
    return [...this.events];
  }
}
