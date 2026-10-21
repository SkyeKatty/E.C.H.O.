import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "./module-registry.js";

describe("ModuleRegistry", () => {
  it("registers and snapshots modules", () => {
    const onChange = vi.fn();
    const registry = new ModuleRegistry({ onChange, heartbeatTimeoutMs: 1000 });

    registry.register({
      socketId: "s1",
      moduleId: "mock-1",
      name: "Mock",
      version: "0.1.0",
      protocolVersion: "1",
      capabilities: [{ id: "mock.echo", name: "Echo", version: "1.0.0", enabled: true, supportsStreaming: false, supportsCancellation: true }],
    });

    expect(onChange).toHaveBeenCalled();
    const snap = registry.snapshot();
    expect(snap.modules).toHaveLength(1);
    expect(snap.modules[0].connectionState).toBe("ready");
  });

  it("marks modules degraded after heartbeat timeout", () => {
    vi.useFakeTimers();
    const registry = new ModuleRegistry({ heartbeatTimeoutMs: 1000 });
    registry.register({
      socketId: "s1",
      moduleId: "mock-1",
      name: "Mock",
      version: "0.1.0",
      protocolVersion: "1",
      capabilities: [],
    });

    vi.advanceTimersByTime(1500);
    const degraded = registry.evaluateHeartbeats(Date.now());
    expect(degraded).toContain("mock-1");
    expect(registry.get("mock-1")?.connectionState).toBe("degraded");
    vi.useRealTimers();
  });

  it("finds capability owner", () => {
    const registry = new ModuleRegistry();
    registry.register({
      socketId: "s1",
      moduleId: "mock-1",
      name: "Mock",
      version: "0.1.0",
      protocolVersion: "1",
      capabilities: [{ id: "mock.echo", name: "Echo", version: "1.0.0", enabled: true, supportsStreaming: false, supportsCancellation: true }],
    });
    expect(registry.findCapabilityOwner("mock.echo")?.moduleId).toBe("mock-1");
  });
});
