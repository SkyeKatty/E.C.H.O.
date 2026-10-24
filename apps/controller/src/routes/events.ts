import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventLog } from "../persona/event-log.js";

const severityEnum = z.enum(["error", "warn", "info"]);

function queryParamArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((val) => {
    if (val === undefined || val === "") return undefined;
    return Array.isArray(val) ? val : [val];
  }, z.array(item).optional());
}

const eventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  since: z.string().max(64).optional(),
  until: z.string().max(64).optional(),
  type: queryParamArray(z.string().max(120)),
  moduleId: z.string().max(120).optional(),
  severity: queryParamArray(severityEnum),
  q: z.string().max(200).optional(),
});

export async function registerEventRoutes(app: FastifyInstance, eventLog: EventLog): Promise<void> {
  app.get("/api/v1/events", async (req, reply) => {
    const parsed = eventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { type, severity, ...rest } = parsed.data;
    return eventLog.query({
      ...rest,
      types: type,
      severities: severity,
    });
  });

  app.get("/api/v1/events/types", async () => {
    const types = new Set<string>();
    for (const e of eventLog.list()) {
      types.add(e.type);
    }
    return { types: [...types].sort() };
  });
}
