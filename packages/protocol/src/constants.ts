/** Wire protocol version — bump on breaking envelope or semantics changes. */
export const PROTOCOL_VERSION = "1" as const;

export const MESSAGE_TYPES = {
  MODULE_REGISTER: "module.register",
  MODULE_REGISTERED: "module.registered",
  MODULE_DEREGISTER: "module.deregister",
  MODULE_HEARTBEAT: "module.heartbeat",
  MODULE_HEALTH: "module.health",
  CAPABILITY_LIST: "capability.list",
  CAPABILITY_UPDATE: "capability.update",
  EVENT_PUBLISH: "event.publish",
  REQUEST: "request",
  RESPONSE: "response",
  STREAM_CHUNK: "stream.chunk",
  STREAM_END: "stream.end",
  TASK_UPDATE: "task.update",
  CANCEL: "cancel",
  CONFIG_UPDATE: "config.update",
  ERROR: "error",
  LOG: "log",
  CONTROLLER_ACK: "controller.ack",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export const MODULE_CONNECTION_STATES = [
  "connecting",
  "connected",
  "ready",
  "busy",
  "degraded",
  "disconnected",
] as const;

export type ModuleConnectionState = (typeof MODULE_CONNECTION_STATES)[number];

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_MESSAGE_BYTES = 512 * 1024;
