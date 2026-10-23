import { randomUUID } from "node:crypto";
import { timeDateSchema, timeNowSchema, timeTimerCancelSchema, timeTimerCreateSchema } from "@echo/time-contract";
import type { ControllerClient } from "./controller-client.js";

export type TimerRecord = {
  id: string;
  description: string;
  sessionId: string;
  personaId?: string;
  notifyDiscord?: { channelId: string; guildId?: string };
  mentionUserIds?: string[];
  fireAt: string;
  createdAt: string;
};

type PendingTimer = TimerRecord & {
  handle: ReturnType<typeof setTimeout>;
};

function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function resolveTimezone(tz?: string): string {
  const candidate =
    tz?.trim() || process.env.ECHO_TIME_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (isValidIanaTimezone(candidate)) {
    return candidate;
  }
  console.warn(`[time] Invalid timezone "${candidate}" — use IANA names (e.g. America/Halifax). Falling back to UTC.`);
  return "UTC";
}

/** DST-aware offset label at `instant`, e.g. "GMT-3" or "GMT-4". */
function utcOffsetLabel(instant: Date, timezone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

function formatNow(timezone: string) {
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "shortGeneric",
  }).format(now);
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longGeneric",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;

  return {
    /** UTC instant — not wall-clock time; use localTime when speaking to users. */
    iso: now.toISOString(),
    unixMs: now.getTime(),
    timezone,
    localDate,
    localTime,
    localDateTime: `${localDate} ${localTime}`,
    utcOffset: utcOffsetLabel(now, timezone),
    timeZoneName,
  };
}

function formatDate(timezone: string) {
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    localDate,
    timezone,
    weekday: pick("weekday"),
    year: Number(pick("year")),
    month: pick("month"),
    day: Number(pick("day")),
    formatted: `${pick("weekday")}, ${pick("month")} ${pick("day")}, ${pick("year")}`,
    utcOffset: utcOffsetLabel(now, timezone),
  };
}

function formatInstantInZone(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
  return `${localDate} ${localTime} (${utcOffsetLabel(d, timezone)})`;
}

export class TimekeepingRuntime {
  private readonly timers = new Map<string, PendingTimer>();

  constructor(private readonly controller: ControllerClient) {}

  getStatus() {
    return {
      activeTimers: this.timers.size,
      timezone: resolveTimezone(),
    };
  }

  now(params: unknown) {
    const { timezone } = timeNowSchema.parse(params ?? {});
    return formatNow(resolveTimezone(timezone));
  }

  date(params: unknown) {
    const { timezone } = timeDateSchema.parse(params ?? {});
    return formatDate(resolveTimezone(timezone));
  }

  createTimer(params: unknown) {
    const body = timeTimerCreateSchema.parse(params);
    if (!body.sessionId) {
      throw new Error("sessionId is required (controller should inject it for chat tools)");
    }
    const delayMs =
      body.delaySeconds !== undefined
        ? body.delaySeconds * 1000
        : (body.delayMinutes ?? 1) * 60 * 1000;

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const fireAt = new Date(Date.now() + delayMs).toISOString();

    const record: TimerRecord = {
      id,
      description: body.description,
      sessionId: body.sessionId,
      personaId: body.personaId,
      notifyDiscord: body.notifyDiscord,
      mentionUserIds: body.mentionUserIds,
      fireAt,
      createdAt,
    };

    const handle = setTimeout(() => {
      void this.fireTimer(id);
    }, delayMs);

    if (typeof handle.unref === "function") {
      handle.unref();
    }

    this.timers.set(id, { ...record, handle });
    console.log(`[time] Timer ${id} in ${Math.round(delayMs / 1000)}s — ${body.description.slice(0, 80)}`);

    const tz = resolveTimezone();
    return {
      timerId: id,
      fireAt,
      fireAtLocal: formatInstantInZone(fireAt, tz),
      delayMs,
      description: body.description,
      timezone: tz,
    };
  }

  listTimers() {
    return {
      timers: [...this.timers.values()].map(({ handle: _h, ...t }) => t),
    };
  }

  cancelTimer(params: unknown) {
    const { timerId } = timeTimerCancelSchema.parse(params);
    const pending = this.timers.get(timerId);
    if (!pending) {
      return { cancelled: false, reason: "not_found" as const };
    }
    clearTimeout(pending.handle);
    this.timers.delete(timerId);
    return { cancelled: true, timerId };
  }

  destroyAll(): void {
    for (const t of this.timers.values()) {
      clearTimeout(t.handle);
    }
    this.timers.clear();
  }

  private async fireTimer(id: string): Promise<void> {
    const pending = this.timers.get(id);
    if (!pending) return;
    this.timers.delete(id);
    clearTimeout(pending.handle);

    const firedAt = new Date().toISOString();
    console.log(`[time] Timer fired ${id}: ${pending.description.slice(0, 80)}`);

    try {
      await this.controller.postTimerFired({
        timerId: id,
        description: pending.description,
        sessionId: pending.sessionId,
        personaId: pending.personaId,
        firedAt,
        notifyDiscord: pending.notifyDiscord,
        mentionUserIds: pending.mentionUserIds,
      });
    } catch (err) {
      console.error("[time] Failed to notify controller:", err);
    }
  }
}
