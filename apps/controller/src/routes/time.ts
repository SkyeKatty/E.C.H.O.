import type { FastifyInstance } from "fastify";
import { timeTimerFiredSchema } from "@echo/time-contract";
import type { TimeOrchestrator } from "../time/time-orchestrator.js";
import type { TimeModuleService } from "../time/time-module-service.js";

export function registerTimeRoutes(
  app: FastifyInstance,
  opts: {
    time: TimeModuleService;
    orchestrator: TimeOrchestrator;
    moduleAuthToken?: string;
  },
): void {
  const authorizeModule = (authHeader: string | undefined): boolean => {
    if (!opts.moduleAuthToken) return true;
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    return token === opts.moduleAuthToken;
  };

  app.get("/api/v1/time/status", async () => {
    let health: unknown = null;
    if (opts.time.isAvailable()) {
      try {
        health = await opts.time.getHealth();
      } catch {
        health = { error: "health_unavailable" };
      }
    }
    return {
      moduleAvailable: opts.time.isAvailable(),
      moduleId: opts.time.getModuleId(),
      health,
    };
  });

  app.post("/api/v1/time/timer-fired", async (req, reply) => {
    if (!authorizeModule(req.headers.authorization)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const parsed = timeTimerFiredSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    void opts.orchestrator.handleTimerFired(parsed.data);
    return { accepted: true };
  });
}
