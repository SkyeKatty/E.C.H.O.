import type { WebSocket, RawData } from "ws";
import {
  MESSAGE_TYPES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  createEnvelope,
  registerPayloadSchema,
  healthPayloadSchema,
  responsePayloadSchema,
  streamChunkPayloadSchema,
  streamEndPayloadSchema,
  safeParseEnvelope,
  type Envelope,
} from "@echo/protocol";
import type { FastifyBaseLogger } from "fastify";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { EventLog } from "../persona/state.js";
import { LLM_SETTINGS_GET } from "../llm/constants.js";

type SocketMeta = {
  socketId: string;
  moduleId?: string;
  registered: boolean;
};

type PendingModuleRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onChunk?: (chunk: unknown) => void;
  moduleId?: string;
  requestMessageId?: string;
};

export class ModuleGateway {
  private sockets = new Map<WebSocket, SocketMeta>();
  private pendingRequests = new Map<string, PendingModuleRequest>();

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly eventLog: EventLog,
    private readonly controllerId: string,
    private readonly moduleAuthToken: string | undefined,
    private readonly log: FastifyBaseLogger,
    private readonly onRegistryChange: () => void,
    private readonly onLlmModuleAvailabilityChange?: () => void,
  ) {}

  private static moduleProvidesLlm(capabilities: { id: string }[]): boolean {
    return capabilities.some((c) => c.id === LLM_SETTINGS_GET);
  }

  attach(socket: WebSocket): void {
    const socketId = crypto.randomUUID();
    this.sockets.set(socket, { socketId, registered: false });

    socket.on("message", (raw) => {
      void this.onMessage(socket, raw);
    });

    socket.on("close", () => {
      this.onClose(socket);
    });
  }

  private async onMessage(socket: WebSocket, raw: RawData): Promise<void> {
    const data = raw.toString();
    if (data.length > MAX_MESSAGE_BYTES) {
      this.sendError(socket, "MESSAGE_TOO_LARGE", "Message exceeds size limit");
      socket.close(1009, "message too large");
      return;
    }

    let parsed: ReturnType<typeof safeParseEnvelope>;
    try {
      parsed = safeParseEnvelope(JSON.parse(data));
    } catch {
      this.sendError(socket, "INVALID_JSON", "Message is not valid JSON");
      return;
    }

    if (!parsed.success) {
      this.sendError(socket, "INVALID_ENVELOPE", "Envelope validation failed");
      return;
    }

    const envelope = parsed.data;
    const meta = this.sockets.get(socket);
    if (!meta) return;

    try {
      await this.route(socket, meta, envelope);
    } catch (err) {
      this.log.error({ err, type: envelope.type }, "Module message handling failed");
      this.reply(socket, envelope, {
        payload: {},
        error: { code: "INTERNAL_ERROR", message: "Controller error processing message" },
      });
    }
  }

  private async route(socket: WebSocket, meta: SocketMeta, envelope: Envelope): Promise<void> {
    switch (envelope.type) {
      case MESSAGE_TYPES.MODULE_REGISTER:
        this.handleRegister(socket, meta, envelope);
        break;
      case MESSAGE_TYPES.MODULE_HEARTBEAT:
        this.handleHeartbeat(meta, envelope);
        break;
      case MESSAGE_TYPES.MODULE_HEALTH:
        this.handleHealth(meta, envelope);
        break;
      case MESSAGE_TYPES.RESPONSE:
        if (envelope.correlationId && this.pendingRequests.has(envelope.correlationId)) {
          this.finishPendingRequest(envelope.correlationId, envelope);
        } else {
          this.eventLog.append({
            type: "module.response",
            summary: `Response from ${envelope.source}`,
            moduleId: envelope.source,
          });
          this.onRegistryChange();
        }
        break;
      case MESSAGE_TYPES.STREAM_CHUNK:
        if (envelope.correlationId) {
          this.handleStreamChunk(envelope.correlationId, envelope);
        }
        break;
      case MESSAGE_TYPES.STREAM_END:
        if (envelope.correlationId && this.pendingRequests.has(envelope.correlationId)) {
          this.finishStreamEnd(envelope.correlationId, envelope);
        }
        break;
      default:
        if (!meta.registered) {
          this.sendError(socket, "NOT_REGISTERED", "Module must register first");
          return;
        }
        this.log.debug({ type: envelope.type, source: envelope.source }, "Unhandled module message");
    }
  }

  private handleRegister(socket: WebSocket, meta: SocketMeta, envelope: Envelope): void {
    const result = registerPayloadSchema.safeParse(envelope.payload);
    if (!result.success) {
      this.reply(socket, envelope, {
        payload: {
          moduleId: "unknown",
          accepted: false,
          controllerId: this.controllerId,
          heartbeatIntervalMs: this.registry.getHeartbeatIntervalMs(),
          heartbeatTimeoutMs: this.registry.getHeartbeatTimeoutMs(),
          reason: "Invalid registration payload",
        } satisfies import("@echo/protocol").ModuleRegisteredPayload,
        type: MESSAGE_TYPES.MODULE_REGISTERED,
      });
      return;
    }

    const reg = result.data;
    if (reg.protocolVersion !== PROTOCOL_VERSION) {
      this.reply(socket, envelope, {
        type: MESSAGE_TYPES.MODULE_REGISTERED,
        payload: {
          moduleId: reg.moduleId,
          accepted: false,
          controllerId: this.controllerId,
          heartbeatIntervalMs: this.registry.getHeartbeatIntervalMs(),
          heartbeatTimeoutMs: this.registry.getHeartbeatTimeoutMs(),
          reason: `Unsupported protocol version: ${reg.protocolVersion}`,
        },
      });
      return;
    }

    if (this.moduleAuthToken && reg.authToken !== this.moduleAuthToken) {
      this.reply(socket, envelope, {
        type: MESSAGE_TYPES.MODULE_REGISTERED,
        payload: {
          moduleId: reg.moduleId,
          accepted: false,
          controllerId: this.controllerId,
          heartbeatIntervalMs: this.registry.getHeartbeatIntervalMs(),
          heartbeatTimeoutMs: this.registry.getHeartbeatTimeoutMs(),
          reason: "Authentication failed",
        },
      });
      socket.close(1008, "auth failed");
      return;
    }

    meta.moduleId = reg.moduleId;
    meta.registered = true;

    this.registry.register({
      socketId: meta.socketId,
      moduleId: reg.moduleId,
      name: reg.name,
      version: reg.version,
      protocolVersion: reg.protocolVersion,
      capabilities: reg.capabilities,
      host: reg.host,
      metadata: reg.metadata as Record<string, unknown> | undefined,
    });

    this.eventLog.append({
      type: "module.registered",
      summary: `Module ${reg.name} (${reg.moduleId}) registered with ${reg.capabilities.length} capabilities`,
      moduleId: reg.moduleId,
    });

    this.reply(socket, envelope, {
      type: MESSAGE_TYPES.MODULE_REGISTERED,
      payload: {
        moduleId: reg.moduleId,
        accepted: true,
        controllerId: this.controllerId,
        heartbeatIntervalMs: this.registry.getHeartbeatIntervalMs(),
        heartbeatTimeoutMs: this.registry.getHeartbeatTimeoutMs(),
      },
    });

    this.onRegistryChange();
    if (ModuleGateway.moduleProvidesLlm(reg.capabilities)) {
      this.onLlmModuleAvailabilityChange?.();
    }
  }

  private handleHeartbeat(meta: SocketMeta, _envelope: Envelope): void {
    if (!meta.registered || !meta.moduleId) return;
    const wasDegraded = this.registry.get(meta.moduleId)?.connectionState === "degraded";
    this.registry.touchHeartbeat(meta.moduleId);
    if (wasDegraded) {
      this.onRegistryChange();
    }
  }

  private handleHealth(meta: SocketMeta, envelope: Envelope): void {
    if (!meta.registered || !meta.moduleId) return;
    const parsed = healthPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) return;
    this.registry.updateHealth(meta.moduleId, parsed.data);
    this.onRegistryChange();
  }

  private onClose(socket: WebSocket): void {
    const meta = this.sockets.get(socket);
    if (!meta) return;
    const disconnected = this.registry.disconnectBySocket(meta.socketId);
    if (disconnected) {
      this.eventLog.append({
        type: "module.disconnected",
        summary: `Module ${disconnected.name} disconnected`,
        moduleId: disconnected.moduleId,
      });
      if (ModuleGateway.moduleProvidesLlm(disconnected.capabilities)) {
        this.onLlmModuleAvailabilityChange?.();
      }
    }
    this.sockets.delete(socket);
    this.onRegistryChange();
  }

  async invokeCapability(
    capabilityId: string,
    params: unknown,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      taskId?: string;
      onChunk?: (chunk: unknown) => void;
    },
  ): Promise<unknown> {
    const owner = this.registry.findCapabilityOwner(capabilityId);
    if (!owner) {
      throw new Error(`No connected module provides capability "${capabilityId}"`);
    }
    if (owner.connectionState === "disconnected" || owner.healthStatus === "unavailable") {
      throw new Error(`Module for "${capabilityId}" is unavailable`);
    }

    this.registry.setBusy(owner.moduleId, true);
    const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = createEnvelope({
          type: MESSAGE_TYPES.REQUEST,
          source: this.controllerId,
          destination: owner.moduleId,
          taskId: options?.taskId,
          payload: { capabilityId, params },
        });

        const timer = setTimeout(() => {
          this.pendingRequests.delete(request.messageId);
          reject(new Error(`Module request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const onAbort = () => {
          clearTimeout(timer);
          this.pendingRequests.delete(request.messageId);
          this.sendCancelToModule(owner.moduleId, request.messageId, options?.taskId);
          reject(new DOMException("Aborted", "AbortError"));
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });

        this.pendingRequests.set(request.messageId, {
          resolve: (value) => {
            clearTimeout(timer);
            options?.signal?.removeEventListener("abort", onAbort);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            options?.signal?.removeEventListener("abort", onAbort);
            reject(error);
          },
          timer,
          onChunk: options?.onChunk,
          moduleId: owner.moduleId,
          requestMessageId: request.messageId,
        });

        const sent = this.sendToModule(owner.moduleId, request);
        if (!sent) {
          clearTimeout(timer);
          this.pendingRequests.delete(request.messageId);
          reject(new Error(`Failed to send request to module ${owner.moduleId}`));
        }
      });
    } finally {
      this.registry.setBusy(owner.moduleId, false);
    }
  }

  private handleStreamChunk(correlationId: string, envelope: Envelope): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending?.onChunk) return;
    const parsed = streamChunkPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) return;
    pending.onChunk(parsed.data.chunk);
  }

  private finishStreamEnd(correlationId: string, envelope: Envelope): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);

    const parsed = streamEndPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      pending.reject(new Error("Invalid stream.end payload"));
      return;
    }
    if (parsed.data.error) {
      pending.reject(new Error(parsed.data.error.message));
      return;
    }
    pending.resolve(parsed.data.result);
  }

  private sendCancelToModule(moduleId: string, correlationId: string, taskId?: string): void {
    const envelope = createEnvelope({
      type: MESSAGE_TYPES.CANCEL,
      source: this.controllerId,
      destination: moduleId,
      correlationId,
      taskId,
      payload: { correlationId, taskId, reason: "client_abort" },
    });
    this.sendToModule(moduleId, envelope);
  }

  private finishPendingRequest(correlationId: string, envelope: Envelope): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);

    const parsed = responsePayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      pending.reject(new Error("Invalid module response payload"));
      return;
    }
    if (parsed.data.error) {
      pending.reject(new Error(parsed.data.error.message));
      return;
    }
    pending.resolve(parsed.data.result);
  }

  sendToModule(moduleId: string, envelope: Envelope): boolean {
    for (const [socket, meta] of this.sockets) {
      if (meta.moduleId === moduleId && meta.registered && socket.readyState === 1) {
        socket.send(JSON.stringify(envelope));
        return true;
      }
    }
    return false;
  }

  private reply(
    socket: WebSocket,
    request: Envelope,
    overrides: Partial<Envelope> & { payload: unknown; type?: string },
  ): void {
    const envelope = createEnvelope({
      type: overrides.type ?? MESSAGE_TYPES.RESPONSE,
      source: this.controllerId,
      destination: request.source,
      correlationId: request.messageId,
      payload: overrides.payload,
      error: overrides.error,
    });
    socket.send(JSON.stringify(envelope));
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    const envelope = createEnvelope({
      type: MESSAGE_TYPES.ERROR,
      source: this.controllerId,
      payload: {},
      error: { code, message },
    });
    socket.send(JSON.stringify(envelope));
  }
}
