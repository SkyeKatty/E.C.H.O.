/** Turn opaque "operation was aborted" / AbortError into actionable log lines. */

export function formatAbortReason(reason: unknown): string {
  if (reason == null) return "no abort reason recorded";
  if (typeof reason === "string") return reason;
  if (reason instanceof DOMException) {
    const msg = reason.message?.trim();
    if (msg && msg !== "Aborted" && msg !== "The operation was aborted.") return `${reason.name}: ${msg}`;
    return reason.name || "AbortError";
  }
  if (reason instanceof Error) return reason.message || reason.name;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

export function isAbortLike(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return m === "aborted" || m.includes("operation was aborted") || err.name === "AbortError";
  }
  return false;
}

export type OperationalErrorContext = {
  /** e.g. discord.voice.join, llm.complete */
  operation?: string;
  capabilityId?: string;
  moduleId?: string;
  taskId?: string;
  sessionId?: string;
  timeoutMs?: number;
};

export function describeOperationalError(
  err: unknown,
  ctx: OperationalErrorContext = {},
): { message: string; logLine: string } {
  const parts: string[] = [];
  if (ctx.operation) parts.push(ctx.operation);
  if (ctx.capabilityId) parts.push(`cap=${ctx.capabilityId}`);
  if (ctx.moduleId) parts.push(`module=${ctx.moduleId}`);
  if (ctx.taskId) parts.push(`task=${ctx.taskId.slice(0, 8)}`);
  if (ctx.sessionId) parts.push(`session=${ctx.sessionId.slice(0, 12)}`);
  if (ctx.timeoutMs) parts.push(`timeoutMs=${ctx.timeoutMs}`);

  let message: string;
  if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  } else {
    message = "unknown error";
  }

  if (isAbortLike(err)) {
    const voiceCap = ctx.capabilityId?.startsWith("discord.voice.");
    const nested = err instanceof Error && "cause" in err && err.cause != null;
    if (voiceCap && message.includes("Voice connection did not reach Ready")) {
      // Already actionable from the Discord module — do not blame chat abort.
    } else if (voiceCap && /operation was aborted/i.test(message)) {
      message =
        "Discord voice timed out waiting for Ready (~20s default in @discordjs/voice). " +
        "Usually UDP/firewall, missing libsodium/opus, or missing Connect/Speak — not dashboard chat cancel.";
    } else {
      const reason = nested
        ? formatAbortReason(err.cause)
        : message === "Aborted" || message.toLowerCase().includes("operation was aborted")
          ? "parent task cancelled or upstream abort signal"
          : message;
      const hint = ctx.timeoutMs
        ? ` (often LLM/module timeout ${ctx.timeoutMs}ms or chat task cancelled)`
        : " (often chat cancelled, superseding turn, or module gateway abort)";
      message = `Aborted: ${reason}${hint}`;
    }
  }

  const prefix = parts.length ? `[${parts.join(" ")}] ` : "";
  return { message, logLine: `${prefix}${message}` };
}
