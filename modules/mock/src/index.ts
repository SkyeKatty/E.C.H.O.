import os from "node:os";
import { ModuleClient } from "@echo/module-sdk";

const controllerUrl =
  process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const moduleId = process.env.ECHO_MOCK_MODULE_ID ?? "mock-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const client = new ModuleClient({
  controllerUrl,
  authToken,
  registration: {
    moduleId,
    name: "Mock Capability Module",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [
      {
        id: "mock.echo",
        name: "Echo",
        description: "Returns the input payload for protocol testing",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: false,
        supportsCancellation: true,
      },
      {
        id: "mock.status",
        name: "Status",
        description: "Reports mock module health metadata",
        version: "1.0.0",
        enabled: true,
        supportsStreaming: false,
        supportsCancellation: true,
      },
    ],
  },
  logger: {
    info: (o, m) => console.log(`[mock] ${m ?? "info"}`, o),
    warn: (o, m) => console.warn(`[mock] ${m ?? "warn"}`, o),
    error: (o, m) => console.error(`[mock] ${m ?? "error"}`, o),
    debug: () => {},
  },
  onRegistered: () => console.log("[mock] Registered with controller"),
  onDisconnected: () => console.log("[mock] Disconnected from controller"),
});

client.registerHandler("mock.echo", (_env, params) => ({
  echoed: params ?? null,
  at: new Date().toISOString(),
}));

client.registerHandler("mock.status", () => ({
  status: "ready",
  uptime: process.uptime(),
  pid: process.pid,
}));

await client.start();

async function shutdown(): Promise<void> {
  console.log("[mock] Shutting down");
  client.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
