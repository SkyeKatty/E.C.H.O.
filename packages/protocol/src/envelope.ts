import { z } from "zod";
import { PROTOCOL_VERSION } from "./constants.js";

export const protocolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
});

export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export const envelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.string().min(1),
  messageId: z.string().uuid(),
  correlationId: z.string().uuid().optional(),
  source: z.string().min(1),
  destination: z.string().optional(),
  timestamp: z.string().datetime(),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  payload: z.unknown(),
  error: protocolErrorSchema.optional(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export function createEnvelope(input: {
  type: string;
  source: string;
  payload: unknown;
  messageId?: string;
  correlationId?: string;
  destination?: string;
  sessionId?: string;
  taskId?: string;
  error?: ProtocolError;
}): Envelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: input.type,
    messageId: input.messageId ?? crypto.randomUUID(),
    correlationId: input.correlationId,
    source: input.source,
    destination: input.destination,
    timestamp: new Date().toISOString(),
    sessionId: input.sessionId,
    taskId: input.taskId,
    payload: input.payload,
    error: input.error,
  };
}

export function parseEnvelope(raw: unknown): Envelope {
  return envelopeSchema.parse(raw);
}

export function safeParseEnvelope(raw: unknown) {
  return envelopeSchema.safeParse(raw);
}
