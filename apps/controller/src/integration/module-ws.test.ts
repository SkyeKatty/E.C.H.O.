import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createEnvelope,
  type ModuleRegisteredPayload,
} from "@echo/protocol";
import { loadConfig } from "../config.js";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";

describe("module WebSocket integration", () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    const base = loadConfig();
    const built = await buildServer({
      ...base,
      controller: {
        ...base.controller,
        id: "test-controller",
        host: "127.0.0.1",
        port: 0,
      },
      persona: { ...base.persona, name: "Test", reactiveOnly: true },
      cognition: { ...base.cognition, llmAdapter: "module", defaultProvider: "local-gpu" },
      logging: { level: "fatal", pretty: false },
    });
    app = built.app;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    port = typeof addr === "object" && addr ? addr.port : 8787;
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a module and exposes it via status API", async () => {
    const wsUrl = `ws://127.0.0.1:${port}/ws/modules`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const register = createEnvelope({
      type: MESSAGE_TYPES.MODULE_REGISTER,
      source: "test-mock",
      payload: {
        moduleId: "test-mock",
        name: "Test Mock",
        version: "0.0.1",
        protocolVersion: PROTOCOL_VERSION,
        capabilities: [{ id: "mock.echo", name: "Echo", version: "1.0.0", enabled: true, supportsStreaming: false, supportsCancellation: true }],
      },
    });

    const registered = new Promise<ModuleRegisteredPayload>((resolve, reject) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; payload: ModuleRegisteredPayload };
        if (msg.type === MESSAGE_TYPES.MODULE_REGISTERED) {
          resolve(msg.payload);
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });

    ws.send(JSON.stringify(register));
    const payload = await registered;
    expect(payload.accepted).toBe(true);

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
    const status = (await res.json()) as { modules: { modules: { moduleId: string }[] } };
    expect(status.modules.modules.some((m) => m.moduleId === "test-mock")).toBe(true);

    ws.close();
  });

  it("supersedes duplicate moduleId connections without marking module disconnected", async () => {
    const wsUrl = `ws://127.0.0.1:${port}/ws/modules`;
    const caps = [
      {
        id: "mock.echo",
        name: "Echo",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: false,
        supportsCancellation: true,
      },
    ];

    const openAndRegister = async (suffix: string) => {
      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });
      const registered = new Promise<ModuleRegisteredPayload>((resolve, reject) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString()) as { type: string; payload: ModuleRegisteredPayload };
          if (msg.type === MESSAGE_TYPES.MODULE_REGISTERED) resolve(msg.payload);
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 5000);
      });
      ws.send(
        JSON.stringify(
          createEnvelope({
            type: MESSAGE_TYPES.MODULE_REGISTER,
            source: `dup-mock-${suffix}`,
            payload: {
              moduleId: "dup-mock",
              name: "Dup Mock",
              version: "0.0.1",
              protocolVersion: PROTOCOL_VERSION,
              capabilities: caps,
            },
          }),
        ),
      );
      const payload = await registered;
      expect(payload.accepted).toBe(true);
      return ws;
    };

    const ws1 = await openAndRegister("a");
    const ws2 = await openAndRegister("b");

    await new Promise((r) => setTimeout(r, 80));

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
    const status = (await res.json()) as {
      modules: { modules: { moduleId: string; connectionState: string }[] };
    };
    const mod = status.modules.modules.find((m) => m.moduleId === "dup-mock");
    expect(mod?.connectionState).toBe("ready");

    ws1.close();
    await new Promise((r) => setTimeout(r, 80));

    const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
    const status2 = (await res2.json()) as {
      modules: { modules: { moduleId: string; connectionState: string }[] };
    };
    const mod2 = status2.modules.modules.find((m) => m.moduleId === "dup-mock");
    expect(mod2?.connectionState).toBe("ready");

    ws2.close();
  });
});
