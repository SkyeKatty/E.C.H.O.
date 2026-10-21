import { z } from "zod";

export const capabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().default("1.0.0"),
  enabled: z.boolean().default(true),
  supportsStreaming: z.boolean().default(false),
  supportsCancellation: z.boolean().default(true),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export type Capability = z.infer<typeof capabilitySchema>;

export const moduleRegistrationSchema = z.object({
  moduleId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  protocolVersion: z.string().min(1),
  authToken: z.string().optional(),
  host: z
    .object({
      hostname: z.string().optional(),
      platform: z.string().optional(),
      arch: z.string().optional(),
    })
    .optional(),
  capabilities: z.array(capabilitySchema).default([]),
  supportedMessageTypes: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ModuleRegistration = z.infer<typeof moduleRegistrationSchema>;

export const moduleHealthSchema = z.object({
  moduleId: z.string(),
  status: z.enum(["ready", "busy", "degraded", "unavailable"]),
  message: z.string().optional(),
  load: z
    .object({
      activeTasks: z.number().int().nonnegative().optional(),
      queueDepth: z.number().int().nonnegative().optional(),
    })
    .optional(),
  timestamp: z.string().datetime().optional(),
});

export type ModuleHealth = z.infer<typeof moduleHealthSchema>;
