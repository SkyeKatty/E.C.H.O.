import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createEnvelope,
  type ModuleRegisteredPayload,
} from "@echo/protocol";
import { buildServer } from "../server.js";
import type { FastifyInstance } from "fastify";

describe("module WebSocket integration", () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    const built = await buildServer({
      controller: {
        id: "test-controller",
        host: "127.0.0.1",
        port: 0,
        moduleWsPath: "/ws/modules",
        dashboardWsPath: "/ws/dashboard",
      },
      persona: { name: "Test", reactiveOnly: true },
      cognition: {
        llmAdapter: "module",
        defaultProvider: "local-gpu",
        maxToolIterations: 6,
        requestTimeoutMs: 120_000,
        moduleRequestTimeoutMs: 30_000,
      },
      providers: [
        {
          id: "local-gpu",
          type: "openai_compatible",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "test-model",
        },
      ],
      logging: { level: "fatal", pretty: false },
      modules: { heartbeatIntervalMs: 15_000, heartbeatTimeoutMs: 45_000 },
      memory: {},
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
});
