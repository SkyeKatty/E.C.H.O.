export type ModuleRecord = {
  moduleId: string;
  name: string;
  version: string;
  protocolVersion: string;
  connectionState: string;
  healthStatus: string;
  capabilities: {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
  }[];
  host?: { hostname?: string; platform?: string; arch?: string };
  connectedAt: string;
  lastHeartbeatAt: string | null;
  lastHealthAt: string | null;
};

export type SystemSnapshot = {
  controllerId: string;
  uptimeSeconds: number;
  persona: {
    name: string;
    activity: string;
    focus: string;
    channel: string;
    reactiveOnly: boolean;
    processingPaused: boolean;
    autonomyEnabled: boolean;
    activeModel: string | null;
    activeProvider: string | null;
    activeCharacterId: string | null;
    pendingActions: number;
    lastEventSummary: string | null;
  };
  modules: {
    modules: ModuleRecord[];
    updatedAt: string;
  };
  llm: {
    moduleAvailable: boolean;
    adapter?: "module" | "embedded";
    moduleId: string | null;
  };
  character: {
    activeCharacterId: string | null;
    activeCharacterName: string | null;
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
  recentEvents: {
    id: string;
    timestamp: string;
    type: string;
    summary: string;
    moduleId?: string;
  }[];
};
