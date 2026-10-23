import os from "node:os";
import { ModuleClient } from "@echo/module-sdk";
import { TIME_CAPABILITIES } from "@echo/time-contract";
import { capabilityList } from "./capabilities.js";
import { ControllerClient } from "./controller-client.js";
import { TimekeepingRuntime } from "./runtime.js";

const controllerWs = process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const controllerHttp =
  process.env.ECHO_CONTROLLER_HTTP ??
  controllerWs.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws\/modules\/?$/, "");
const moduleId = process.env.ECHO_TIME_MODULE_ID ?? "timekeeping-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const controller = new ControllerClient(controllerHttp, authToken);
const runtime = new TimekeepingRuntime(controller);

const client = new ModuleClient({
  controllerUrl: controllerWs,
  authToken,
  registration: {
    moduleId,
    name: "Timekeeping",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [...capabilityList],
    metadata: { role: "timekeeping" },
  },
  logger: {
    info: (_o, m) => console.log(`[time] ${m ?? "info"}`),
    warn: (_o, m) => console.warn(`[time] ${m ?? "warn"}`),
    error: (_o, m) => console.error(`[time] ${m ?? "error"}`),
    debug: () => {},
  },
  onRegistered: () => {
    console.log("[time] Registered with controller");
  },
});

client.registerHandler(TIME_CAPABILITIES.HEALTH_GET, () => ({
  status: "ok",
  ...runtime.getStatus(),
}));

client.registerHandler(TIME_CAPABILITIES.NOW_GET, (_env, params) => runtime.now(params));
client.registerHandler(TIME_CAPABILITIES.DATE_GET, (_env, params) => runtime.date(params));
client.registerHandler(TIME_CAPABILITIES.TIMER_CREATE, (_env, params) => runtime.createTimer(params));
client.registerHandler(TIME_CAPABILITIES.TIMER_LIST, () => runtime.listTimers());
client.registerHandler(TIME_CAPABILITIES.TIMER_CANCEL, (_env, params) => runtime.cancelTimer(params));

process.on("SIGINT", () => {
  runtime.destroyAll();
  client.stop();
  process.exit(0);
});

await client.start();
