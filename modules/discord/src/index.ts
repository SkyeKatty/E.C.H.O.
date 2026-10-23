import os from "node:os";
import { ModuleClient } from "@echo/module-sdk";
import { DISCORD_CAPABILITIES } from "@echo/discord-contract";
import { DiscordRuntime, capabilityList } from "./runtime.js";

const controllerWs = process.env.ECHO_CONTROLLER_MODULE_WS ?? "ws://127.0.0.1:8787/ws/modules";
const controllerHttp =
  process.env.ECHO_CONTROLLER_HTTP ??
  controllerWs.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws\/modules\/?$/, "");
const moduleId = process.env.ECHO_DISCORD_MODULE_ID ?? "discord-module-1";
const authToken = process.env.ECHO_MODULE_AUTH_TOKEN;

const runtime = new DiscordRuntime(controllerHttp, authToken);

const client = new ModuleClient({
  controllerUrl: controllerWs,
  authToken,
  registration: {
    moduleId,
    name: "Discord Integration",
    version: "0.1.0",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
    },
    capabilities: [...capabilityList],
    metadata: { role: "discord" },
  },
  logger: {
    info: (_o, m) => console.log(`[discord] ${m ?? "info"}`),
    warn: (_o, m) => console.warn(`[discord] ${m ?? "warn"}`),
    error: (_o, m) => console.error(`[discord] ${m ?? "error"}`),
    debug: () => {},
  },
  onRegistered: () => {
    console.log("[discord] Registered — controller will push config when saved");
  },
});

client.registerHandler(DISCORD_CAPABILITIES.HEALTH_GET, () => ({
  status: "ok",
  ...runtime.getStatus(),
}));

client.registerHandler(DISCORD_CAPABILITIES.CONFIG_APPLY, (_env, params) => runtime.applyConfig(params));

client.registerHandler(DISCORD_CAPABILITIES.CONFIG_STATUS, () => runtime.getStatus());

client.registerHandler(DISCORD_CAPABILITIES.MESSAGE_SEND, (_env, params) => runtime.sendMessage(params));

client.registerHandler(DISCORD_CAPABILITIES.EMOJI_LIST, (_env, params) => runtime.listEmojis(params));

client.registerHandler(DISCORD_CAPABILITIES.MEMBER_RESOLVE, (_env, params) =>
  runtime.resolveMembers(params),
);

client.registerHandler(DISCORD_CAPABILITIES.MESSAGE_REACT, (_env, params) => runtime.reactToMessage(params));

client.registerHandler(DISCORD_CAPABILITIES.MESSAGE_REACTIONS_GET, (_env, params) =>
  runtime.getMessageReactions(params),
);

client.registerHandler(DISCORD_CAPABILITIES.VOICE_JOIN, (_env, params) => runtime.joinVoice(params));

client.registerHandler(DISCORD_CAPABILITIES.VOICE_LEAVE, (_env, params) => runtime.leaveVoice(params));

client.registerHandler(DISCORD_CAPABILITIES.VOICE_STATUS, () => runtime.voiceStatus());

client.registerHandler(DISCORD_CAPABILITIES.VOICE_SPEAK, (_env, params) => runtime.speak(params));

client.registerHandler(DISCORD_CAPABILITIES.VOICE_SPEAK_CANCEL, (_env, params) =>
  runtime.cancelSpeak(params as { guildId: string; channelId: string }),
);

await client.start();
