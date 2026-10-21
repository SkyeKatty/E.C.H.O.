import type { Capability, ModuleConnectionState, ModuleHealth } from "@echo/protocol";
import {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from "@echo/protocol";

export type RegisteredModule = {
  moduleId: string;
  name: string;
  version: string;
  protocolVersion: string;
  connectionState: ModuleConnectionState;
  healthStatus: ModuleHealth["status"];
  capabilities: Capability[];
  host?: {
    hostname?: string;
    platform?: string;
    arch?: string;
  };
  connectedAt: string;
  lastHeartbeatAt: string | null;
  lastHealthAt: string | null;
  metadata?: Record<string, unknown>;
};

export type ModuleRegistrySnapshot = {
  modules: RegisteredModule[];
  updatedAt: string;
};

type InternalModule = RegisteredModule & {
  socketId: string;
};

export class ModuleRegistry {
  private modules = new Map<string, InternalModule>();
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private onChange?: () => void;

  constructor(options?: { heartbeatTimeoutMs?: number; heartbeatIntervalMs?: number; onChange?: () => void }) {
    this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.onChange = options?.onChange;
  }

  getHeartbeatIntervalMs(): number {
    return this.heartbeatIntervalMs;
  }

  getHeartbeatTimeoutMs(): number {
    return this.heartbeatTimeoutMs;
  }

  register(input: {
    socketId: string;
    moduleId: string;
    name: string;
    version: string;
    protocolVersion: string;
    capabilities: Capability[];
    host?: RegisteredModule["host"];
    metadata?: Record<string, unknown>;
  }): RegisteredModule {
    const now = new Date().toISOString();
    const existing = this.modules.get(input.moduleId);
    const record: InternalModule = {
      moduleId: input.moduleId,
      name: input.name,
      version: input.version,
      protocolVersion: input.protocolVersion,
      connectionState: "ready",
      healthStatus: "ready",
      capabilities: input.capabilities,
      host: input.host,
      connectedAt: existing?.connectedAt ?? now,
      lastHeartbeatAt: now,
      lastHealthAt: now,
      metadata: input.metadata,
      socketId: input.socketId,
    };
    this.modules.set(input.moduleId, record);
    this.notify();
    return this.toPublic(record);
  }

  touchHeartbeat(moduleId: string): boolean {
    const m = this.modules.get(moduleId);
    if (!m) return false;
    m.lastHeartbeatAt = new Date().toISOString();
    if (m.connectionState === "degraded") {
      m.connectionState = "ready";
      m.healthStatus = "ready";
      this.notify();
    }
    return true;
  }

  updateHealth(moduleId: string, health: ModuleHealth): boolean {
    const m = this.modules.get(moduleId);
    if (!m) return false;
    m.healthStatus = health.status;
    m.lastHealthAt = new Date().toISOString();
    m.connectionState =
      health.status === "ready" ? "ready" : health.status === "busy" ? "busy" : "degraded";
    this.notify();
    return true;
  }

  setBusy(moduleId: string, busy: boolean): void {
    const m = this.modules.get(moduleId);
    if (!m) return;
    const prev = m.connectionState;
    if (busy) {
      m.connectionState = "busy";
      m.healthStatus = "busy";
    } else if (m.healthStatus === "busy") {
      m.connectionState = "ready";
      m.healthStatus = "ready";
    }
    if (m.connectionState !== prev) {
      this.notify();
    }
  }

  disconnectBySocket(socketId: string): RegisteredModule | null {
    for (const m of this.modules.values()) {
      if (m.socketId === socketId) {
        m.connectionState = "disconnected";
        m.healthStatus = "unavailable";
        this.notify();
        return this.toPublic(m);
      }
    }
    return null;
  }

  remove(moduleId: string): void {
    this.modules.delete(moduleId);
    this.notify();
  }

  getBySocket(socketId: string): InternalModule | undefined {
    for (const m of this.modules.values()) {
      if (m.socketId === socketId) return m;
    }
    return undefined;
  }

  get(moduleId: string): RegisteredModule | undefined {
    const m = this.modules.get(moduleId);
    return m ? this.toPublic(m) : undefined;
  }

  snapshot(): ModuleRegistrySnapshot {
    return {
      modules: [...this.modules.values()].map((m) => this.toPublic(m)),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Mark modules stale when heartbeats stop; returns ids that transitioned to degraded. */
  evaluateHeartbeats(now = Date.now()): string[] {
    const degraded: string[] = [];
    for (const m of this.modules.values()) {
      if (m.connectionState === "disconnected") continue;
      const last = m.lastHeartbeatAt ? Date.parse(m.lastHeartbeatAt) : 0;
      if (now - last > this.heartbeatTimeoutMs && m.connectionState !== "degraded") {
        m.connectionState = "degraded";
        m.healthStatus = "degraded";
        degraded.push(m.moduleId);
      }
    }
    if (degraded.length) this.notify();
    return degraded;
  }

  findCapabilityOwner(capabilityId: string): RegisteredModule | undefined {
    for (const m of this.modules.values()) {
      if (m.connectionState === "disconnected") continue;
      const cap = m.capabilities.find((c) => c.id === capabilityId && c.enabled);
      if (cap) return this.toPublic(m);
    }
    return undefined;
  }

  private toPublic(m: InternalModule): RegisteredModule {
    const { socketId: _, ...rest } = m;
    return rest;
  }

  private notify(): void {
    this.onChange?.();
  }
}
