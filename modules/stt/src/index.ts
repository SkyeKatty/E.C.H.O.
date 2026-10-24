import os from "node:os";
import { ModuleClient } from "@echo/module-sdk";
import { STT_CAPABILITIES } from "@echo/voice-contract";
import { ControllerClient } from "./controller-client.js";
import { SttRuntime, capabilityList } from "./runtime.js";

const controllerWs = process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const controllerHttp =
  process.env.ECHO_CONTROLLER_HTTP ??
  controllerWs.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws\/modules\/?$/, "");
const moduleId = process.env.ECHO_STT_MODULE_ID ?? "stt-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const controller = new ControllerClient(controllerHttp, authToken);
const runtime = new SttRuntime(controller);

const client = new ModuleClient({
  controllerUrl: controllerWs,
  authToken,
  registration: {
    moduleId,
    name: "STT",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [...capabilityList],
    metadata: { role: "stt" },
  },
  logger: {
    info: (_o, m) => console.log(`[stt] ${m ?? "info"}`),
    warn: (_o, m) => console.warn(`[stt] ${m ?? "warn"}`),
    error: (_o, m) => console.error(`[stt] ${m ?? "error"}`),
    debug: () => {},
  },
  onRegistered: () => {
    console.log(
      "[stt] Registered — default local OpenAI-compatible STT at",
      process.env.ECHO_STT_TRANSCRIPTION_URL ?? "http://127.0.0.1:8091/v1",
    );
  },
});

client.registerHandler(STT_CAPABILITIES.HEALTH_GET, () => ({
  status: "ok",
  ...runtime.getStatus(),
}));

client.registerHandler(STT_CAPABILITIES.CONFIG_APPLY, (_env, params) => runtime.applyConfig(params));

client.registerHandler(STT_CAPABILITIES.CONFIG_STATUS, () => runtime.getStatus());

client.registerHandler(STT_CAPABILITIES.SESSION_START, (_env, params) => runtime.sessionStart(params));

client.registerHandler(STT_CAPABILITIES.AUDIO_APPEND, (_env, params) => runtime.audioAppend(params));

client.registerHandler(STT_CAPABILITIES.SESSION_END, async (_env, params) => runtime.sessionEnd(params));

await client.start();
