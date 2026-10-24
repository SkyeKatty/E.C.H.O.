import os from "node:os";
import { ModuleClient } from "@echo/module-sdk";
import { TTS_CAPABILITIES } from "@echo/voice-contract";
import { ControllerClient } from "./controller-client.js";
import { TtsRuntime, capabilityList } from "./runtime.js";

const controllerWs = process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const controllerHttp =
  process.env.ECHO_CONTROLLER_HTTP ??
  controllerWs.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws\/modules\/?$/, "");
const moduleId = process.env.ECHO_TTS_MODULE_ID ?? "tts-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const controller = new ControllerClient(controllerHttp, authToken);
const runtime = new TtsRuntime(controller);

const client = new ModuleClient({
  controllerUrl: controllerWs,
  authToken,
  registration: {
    moduleId,
    name: "TTS",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [...capabilityList],
    metadata: { role: "tts" },
  },
  logger: {
    info: (_o, m) => console.log(`[tts] ${m ?? "info"}`),
    warn: (_o, m) => console.warn(`[tts] ${m ?? "warn"}`),
    error: (_o, m) => console.error(`[tts] ${m ?? "error"}`),
    debug: () => {},
  },
  onRegistered: () => {
    console.log(
      "[tts] Registered — Fish Speech (Fish Audio) at",
      process.env.ECHO_TTS_FISH_URL ?? "http://127.0.0.1:8092",
    );
  },
});

client.registerHandler(TTS_CAPABILITIES.HEALTH_GET, () => ({
  status: "ok",
  ...runtime.getStatus(),
}));

client.registerHandler(TTS_CAPABILITIES.CONFIG_APPLY, (_env, params) => runtime.applyConfig(params));

client.registerHandler(TTS_CAPABILITIES.CONFIG_STATUS, () => runtime.getStatus());

client.registerHandler(TTS_CAPABILITIES.SPEECH_ENQUEUE, (_env, params) => runtime.enqueue(params));

client.registerHandler(TTS_CAPABILITIES.SPEECH_FLUSH, (_env, params) => runtime.flush(params));

await client.start();
