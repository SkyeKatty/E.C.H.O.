import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export type SystemEvent = {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  moduleId?: string;
};

export type EventSeverity = "error" | "warn" | "info";

export function eventSeverityForType(type: string): EventSeverity {
  const t = type.toLowerCase();
  if (t.includes("error") || t === "module.cancelled") return "error";
  if (t.includes("warn") || t.includes("abort") || t.includes("timeout") || t.includes("cancel"))
    return "warn";
  return "info";
}

export type EventLogQuery = {
  page?: number;
  pageSize?: number;
  since?: string;
  until?: string;
  /** Match if event type contains any needle (OR). */
  types?: string[];
  moduleId?: string;
  /** Match if derived severity is any listed (OR). Empty = all. */
  severities?: EventSeverity[];
  q?: string;
};

export type EventLogQueryResult = {
  events: SystemEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  persistedCount: number;
};

export type EventLogOptions = {
  dataRoot?: string;
  /** Max events kept in memory and on disk (oldest dropped). */
  maxPersisted?: number;
  onAppend?: (event: SystemEvent) => void;
};

const DEFAULT_MAX_PERSISTED = 10_000;

function parseEventLine(line: string): SystemEvent | null {
  try {
    const raw = JSON.parse(line) as SystemEvent;
    if (typeof raw.id !== "string" || typeof raw.timestamp !== "string") return null;
    if (typeof raw.type !== "string" || typeof raw.summary !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export class EventLog {
  /** Newest first. */
  private events: SystemEvent[] = [];
  private readonly maxPersisted: number;
  private readonly filePath: string;
  private readonly onAppend?: (event: SystemEvent) => void;

  constructor(options: EventLogOptions = {}) {
    this.maxPersisted = options.maxPersisted ?? DEFAULT_MAX_PERSISTED;
    this.onAppend = options.onAppend;
    const root = resolve(options.dataRoot ?? resolve(process.cwd(), "data"));
    this.filePath = resolve(root, "events", "events.jsonl");
    this.loadFromDisk();
  }

  append(event: Omit<SystemEvent, "id" | "timestamp"> & { timestamp?: string }): SystemEvent {
    const record: SystemEvent = {
      id: crypto.randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      summary: event.summary,
      moduleId: event.moduleId,
    };
    this.events.unshift(record);
    if (this.events.length > this.maxPersisted) {
      this.events.length = this.maxPersisted;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
      this.compactFileIfNeeded();
    } catch {
      // Persistence failure should not break runtime logging.
    }
    this.onAppend?.(record);
    return record;
  }

  /** Newest-first list (optional cap). */
  list(limit?: number): SystemEvent[] {
    const all = [...this.events];
    return limit != null && limit > 0 ? all.slice(0, limit) : all;
  }

  query(input: EventLogQuery = {}): EventLogQueryResult {
    const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    const sinceMs = input.since ? Date.parse(input.since) : null;
    const untilMs = input.until ? Date.parse(input.until) : null;
    const typeNeedles = (input.types ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const moduleId = input.moduleId?.trim();
    const q = input.q?.trim().toLowerCase();
    const severities = input.severities ?? [];

    const filtered = this.events.filter((e) => {
      const ts = Date.parse(e.timestamp);
      if (sinceMs != null && !Number.isNaN(sinceMs) && ts < sinceMs) return false;
      if (untilMs != null && !Number.isNaN(untilMs) && ts > untilMs) return false;
      if (
        typeNeedles.length &&
        !typeNeedles.some((needle) => e.type.toLowerCase().includes(needle))
      )
        return false;
      if (moduleId && e.moduleId !== moduleId) return false;
      if (
        severities.length &&
        !severities.includes(eventSeverityForType(e.type))
      )
        return false;
      if (q && !e.summary.toLowerCase().includes(q) && !e.type.toLowerCase().includes(q))
        return false;
      return true;
    });

    filtered.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const events = filtered.slice(start, start + pageSize);

    return {
      events,
      total,
      page: safePage,
      pageSize,
      totalPages,
      persistedCount: this.events.length,
    };
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const text = readFileSync(this.filePath, "utf8");
      const parsed: SystemEvent[] = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const ev = parseEventLine(trimmed);
        if (ev) parsed.push(ev);
      }
      parsed.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      this.events = parsed.slice(0, this.maxPersisted);
      if (parsed.length > this.maxPersisted) {
        this.rewriteFileFromMemory();
      }
    } catch {
      this.events = [];
    }
  }

  /** Drop orphaned lines when the in-memory cap trimmed older entries. */
  private compactFileIfNeeded(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const lines = readFileSync(this.filePath, "utf8").split("\n").filter((l) => l.trim());
      if (lines.length <= this.maxPersisted) return;
      this.rewriteFileFromMemory();
    } catch {
      // ignore
    }
  }

  private rewriteFileFromMemory(): void {
    const chronological = [...this.events].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      chronological.map((e) => JSON.stringify(e)).join("\n") + (chronological.length ? "\n" : ""),
      "utf8",
    );
  }
}
