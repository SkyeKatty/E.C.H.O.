import { z } from "zod";
import { moduleHealthSchema, moduleRegistrationSchema } from "./capabilities.js";
import { protocolErrorSchema } from "./envelope.js";

export const moduleRegisteredPayloadSchema = z.object({
  moduleId: z.string(),
  accepted: z.boolean(),
  controllerId: z.string(),
  heartbeatIntervalMs: z.number().int().positive(),
  heartbeatTimeoutMs: z.number().int().positive(),
  reason: z.string().optional(),
});

export type ModuleRegisteredPayload = z.infer<typeof moduleRegisteredPayloadSchema>;

export const requestPayloadSchema = z.object({
  capabilityId: z.string(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type RequestPayload = z.infer<typeof requestPayloadSchema>;

export const responsePayloadSchema = z.object({
  capabilityId: z.string(),
  result: z.unknown().optional(),
  error: protocolErrorSchema.optional(),
});

export type ResponsePayload = z.infer<typeof responsePayloadSchema>;

export const streamChunkPayloadSchema = z.object({
  capabilityId: z.string(),
  chunk: z.unknown(),
});

export type StreamChunkPayload = z.infer<typeof streamChunkPayloadSchema>;

export const streamEndPayloadSchema = z.object({
  capabilityId: z.string(),
  result: z.unknown().optional(),
  error: protocolErrorSchema.optional(),
});

export type StreamEndPayload = z.infer<typeof streamEndPayloadSchema>;

export const cancelPayloadSchema = z.object({
  correlationId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  reason: z.string().optional(),
});

export type CancelPayload = z.infer<typeof cancelPayloadSchema>;

export const heartbeatPayloadSchema = z.object({
  moduleId: z.string(),
  sequence: z.number().int().nonnegative().optional(),
});

export const eventPublishPayloadSchema = z.object({
  eventType: z.string(),
  priority: z.enum(["immediate", "interrupt", "background", "low"]).default("background"),
  data: z.unknown(),
});

export const registerPayloadSchema = moduleRegistrationSchema;
export const healthPayloadSchema = moduleHealthSchema;
