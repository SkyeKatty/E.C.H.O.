import type { Capability, ModuleRegistration } from "@echo/protocol";
import type { Envelope } from "@echo/protocol";

export type ModuleLogger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  debug: (obj: object, msg?: string) => void;
};

export type ModuleRequestContext = {
  signal: AbortSignal;
  /** Send incremental output; final value is still returned from the handler (or via stream.end). */
  sendChunk: (chunk: unknown) => void;
};

export type RequestHandler = (
  envelope: Envelope,
  params: unknown,
  context?: ModuleRequestContext,
) => Promise<unknown> | unknown;

export type ModuleClientOptions = {
  controllerUrl: string;
  registration: Omit<ModuleRegistration, "protocolVersion"> & {
    protocolVersion?: string;
  };
  authToken?: string;
  capabilities?: Capability[];
  heartbeatIntervalMs?: number;
  reconnect?: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    multiplier?: number;
  };
  logger?: ModuleLogger;
  onRegistered?: (info: {
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
  }) => void;
  onDisconnected?: () => void;
  onMessage?: (envelope: Envelope) => void;
};
