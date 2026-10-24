import WebSocket from "ws";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createEnvelope,
  parseEnvelope,
  registerPayloadSchema,
  requestPayloadSchema,
  type Envelope,
  type ModuleRegisteredPayload,
} from "@echo/protocol";
import type { ModuleClientOptions, ModuleLogger, ModuleRequestContext, RequestHandler } from "./types.js";

function formatModuleAbortReason(reason: unknown, fallback: string): string {
  if (reason instanceof DOMException && reason.message) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  if (fallback.toLowerCase().includes("abort")) return fallback;
  return fallback || "operation was aborted";
}

const defaultLogger: ModuleLogger = {
  info: (o, m) => console.log(m ?? "info", o),
  warn: (o, m) => console.warn(m ?? "warn", o),
  error: (o, m) => console.error(m ?? "error", o),
  debug: () => {},
};

export class ModuleClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatSequence = 0;
  private reconnectAttempt = 0;
  private closedIntentionally = false;
  private superseded = false;
  private registered = false;
  private connecting = false;
  private readonly registrationWaiters: Array<() => void> = [];
  private readonly handlers = new Map<string, RequestHandler>();
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly pending = new Map<
    string,
    { resolve: (v: Envelope) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly options: ModuleClientOptions) {}

  registerHandler(capabilityId: string, handler: RequestHandler): void {
    this.handlers.set(capabilityId, handler);
  }

  /** Resolves after the controller accepts registration; retries until connected. */
  async start(): Promise<void> {
    this.closedIntentionally = false;
    if (this.registered) return;

    return new Promise((resolve) => {
      this.registrationWaiters.push(resolve);
      this.ensureConnection();
    });
  }

  stop(): void {
    this.closedIntentionally = true;
    this.registered = false;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Module client stopped"));
    }
    this.pending.clear();
    this.registrationWaiters.length = 0;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "shutdown");
    }
    this.ws = null;
    this.connecting = false;
  }

  send(envelope: Envelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(envelope));
  }

  /** Publish a dashboard-visible event (Overview → recent events). */
  publishEvent(
    eventType: string,
    data: { summary: string; [key: string]: unknown },
    priority: "immediate" | "interrupt" | "background" | "low" = "background",
  ): void {
    if (!this.registered) return;
    try {
      const envelope = createEnvelope({
        type: MESSAGE_TYPES.EVENT_PUBLISH,
        source: this.options.registration.moduleId,
        destination: "controller",
        payload: { eventType, priority, data },
      });
      this.send(envelope);
    } catch (err) {
      this.log.warn({ err, eventType }, "Failed to publish module event");
    }
  }

  private log: ModuleLogger = defaultLogger;

  private ensureConnection(): void {
    if (this.closedIntentionally || this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connecting = true;
    this.log = this.options.logger ?? defaultLogger;

    const ws = new WebSocket(this.options.controllerUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.log.info({ url: this.options.controllerUrl }, "Connected to controller, registering");
      this.sendRegistration();
    });

    ws.on("message", (data) => {
      try {
        const raw = JSON.parse(data.toString()) as unknown;
        const envelope = parseEnvelope(raw);
        void this.handleEnvelope(envelope);
      } catch (err) {
        this.log.error({ err }, "Failed to parse message");
      }
    });

    ws.on("close", (code, reason) => {
      this.clearHeartbeat();
      this.connecting = false;
      this.ws = null;
      this.registered = false;
      if (code === 1000 && reason.toString().includes("superseded")) {
        this.superseded = true;
      }
      this.options.onDisconnected?.();
      if (!this.closedIntentionally && !this.superseded) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      this.log.error(
        { err, url: this.options.controllerUrl },
        "WebSocket error (is the controller running? pnpm dev)",
      );
    });
  }

  private sendRegistration(): void {
    const reg = {
      ...this.options.registration,
      protocolVersion: this.options.registration.protocolVersion ?? PROTOCOL_VERSION,
      authToken: this.options.authToken ?? this.options.registration.authToken,
      capabilities: this.options.capabilities ?? this.options.registration.capabilities ?? [],
    };
    registerPayloadSchema.parse(reg);

    const envelope = createEnvelope({
      type: MESSAGE_TYPES.MODULE_REGISTER,
      source: reg.moduleId,
      payload: reg,
    });
    this.send(envelope);
  }

  private async handleEnvelope(envelope: Envelope): Promise<void> {
    this.options.onMessage?.(envelope);

    if (envelope.correlationId && this.pending.has(envelope.correlationId)) {
      const p = this.pending.get(envelope.correlationId)!;
      clearTimeout(p.timer);
      this.pending.delete(envelope.correlationId);
      p.resolve(envelope);
      return;
    }

    switch (envelope.type) {
      case MESSAGE_TYPES.MODULE_REGISTERED: {
        const payload = envelope.payload as ModuleRegisteredPayload;
        if (payload.accepted) {
          this.registered = true;
          this.startHeartbeat(payload.heartbeatIntervalMs);
          this.options.onRegistered?.({
            heartbeatIntervalMs: payload.heartbeatIntervalMs,
            heartbeatTimeoutMs: payload.heartbeatTimeoutMs,
          });
          for (const resolve of this.registrationWaiters) resolve();
          this.registrationWaiters.length = 0;
        } else {
          this.log.warn({ reason: payload.reason }, "Registration rejected");
          this.stop();
        }
        break;
      }
      case MESSAGE_TYPES.REQUEST: {
        await this.handleRequest(envelope);
        break;
      }
      case MESSAGE_TYPES.CANCEL: {
        const correlationId = envelope.correlationId;
        if (correlationId) {
          const ctrl = this.activeRequests.get(correlationId);
          const reason =
            typeof envelope.payload === "object" &&
            envelope.payload !== null &&
            "reason" in envelope.payload
              ? String((envelope.payload as { reason?: string }).reason ?? "cancel")
              : "cancel";
          this.log.warn({ correlationId, reason }, "Controller cancelled in-flight request");
          ctrl?.abort(new DOMException(`Controller cancelled request (${reason})`, "AbortError"));
        }
        break;
      }
      default:
        break;
    }
  }

  private async handleRequest(envelope: Envelope): Promise<void> {
    const parsed = requestPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      this.sendResponse(envelope, {
        capabilityId: "unknown",
        error: { code: "INVALID_REQUEST", message: "Invalid request payload" },
      });
      return;
    }

    const { capabilityId, params } = parsed.data;
    const handler = this.handlers.get(capabilityId);
    if (!handler) {
      this.sendResponse(envelope, {
        capabilityId,
        error: { code: "CAPABILITY_NOT_FOUND", message: `No handler for ${capabilityId}` },
      });
      return;
    }

    const abort = new AbortController();
    this.activeRequests.set(envelope.messageId, abort);
    let streamed = false;
    const context: ModuleRequestContext = {
      signal: abort.signal,
      sendChunk: (chunk) => {
        streamed = true;
        this.sendStreamChunk(envelope, capabilityId, chunk);
      },
    };

    const started = Date.now();
    try {
      this.log.info({ capabilityId, messageId: envelope.messageId }, "Capability request started");
      const result = await handler(envelope, params ?? parsed.data.params, context);
      if (streamed) {
        this.sendStreamEnd(envelope, { capabilityId, result });
      } else {
        this.sendResponse(envelope, { capabilityId, result });
      }
      this.log.info(
        { capabilityId, ms: Date.now() - started },
        "Capability request completed",
      );
    } catch (err) {
      const aborted = abort.signal.aborted;
      const message = err instanceof Error ? err.message : "Handler failed";
      const abortReason = abort.signal.reason;
      const summary = aborted
        ? `${capabilityId} cancelled: ${formatModuleAbortReason(abortReason, message)}`
        : `${capabilityId} failed: ${message}`;
      this.log.error({ capabilityId, err, aborted, ms: Date.now() - started }, summary);
      // Controller EventLog records module.error from the gateway response — avoid duplicate rows.
      if (aborted) {
        this.publishEvent("module.cancelled", {
          summary,
          capabilityId,
          message,
          aborted,
        });
      }
      const code = aborted ? "ABORTED" : "HANDLER_ERROR";
      const payload = {
        capabilityId,
        error: { code, message: summary },
      };
      if (streamed) {
        this.sendStreamEnd(envelope, payload);
      } else {
        this.sendResponse(envelope, payload);
      }
    } finally {
      this.activeRequests.delete(envelope.messageId);
    }
  }

  private sendStreamChunk(request: Envelope, capabilityId: string, chunk: unknown): void {
    const envelope = createEnvelope({
      type: MESSAGE_TYPES.STREAM_CHUNK,
      source: this.options.registration.moduleId,
      destination: request.source,
      correlationId: request.messageId,
      payload: { capabilityId, chunk },
    });
    this.send(envelope);
  }

  private sendStreamEnd(
    request: Envelope,
    payload: { capabilityId: string; result?: unknown; error?: { code: string; message: string } },
  ): void {
    const envelope = createEnvelope({
      type: MESSAGE_TYPES.STREAM_END,
      source: this.options.registration.moduleId,
      destination: request.source,
      correlationId: request.messageId,
      payload,
      error: payload.error,
    });
    this.send(envelope);
  }

  private sendResponse(
    request: Envelope,
    payload: { capabilityId: string; result?: unknown; error?: { code: string; message: string } },
  ): void {
    const envelope = createEnvelope({
      type: MESSAGE_TYPES.RESPONSE,
      source: this.options.registration.moduleId,
      destination: request.source,
      correlationId: request.messageId,
      payload,
    });
    this.send(envelope);
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? intervalMs;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.heartbeatSequence += 1;
      const envelope = createEnvelope({
        type: MESSAGE_TYPES.MODULE_HEARTBEAT,
        source: this.options.registration.moduleId,
        payload: {
          moduleId: this.options.registration.moduleId,
          sequence: this.heartbeatSequence,
        },
      });
      this.send(envelope);
    }, interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedIntentionally) return;

    const cfg = this.options.reconnect ?? {};
    const initial = cfg.initialDelayMs ?? 1000;
    const max = cfg.maxDelayMs ?? 30_000;
    const mult = cfg.multiplier ?? 2;
    const delay = Math.min(initial * mult ** this.reconnectAttempt, max);
    const jitter = delay * 0.2 * Math.random();
    this.reconnectAttempt += 1;
    this.log.info(
      { delayMs: Math.round(delay + jitter), attempt: this.reconnectAttempt, url: this.options.controllerUrl },
      "Scheduling reconnect to controller",
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay + jitter);
  }
}
