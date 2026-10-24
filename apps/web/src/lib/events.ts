export type SystemEvent = {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  moduleId?: string;
};

export type EventSeverity = "error" | "warn" | "info";

export const EVENT_SEVERITIES: EventSeverity[] = ["error", "warn", "info"];

export function eventSeverity(type: string): EventSeverity {
  const t = type.toLowerCase();
  if (t.includes("error") || t === "module.cancelled") return "error";
  if (t.includes("warn") || t.includes("abort") || t.includes("timeout") || t.includes("cancel"))
    return "warn";
  return "info";
}

export type EventsQueryResult = {
  events: SystemEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  persistedCount: number;
};

export type TimeRangePreset = "1h" | "24h" | "7d" | "all" | "custom";

export function presetToSince(preset: TimeRangePreset): string | undefined {
  if (preset === "all" || preset === "custom") return undefined;
  const now = Date.now();
  const ms =
    preset === "1h" ? 3_600_000 : preset === "24h" ? 86_400_000 : 7 * 86_400_000;
  return new Date(now - ms).toISOString();
}

export function eventMatchesFilters(
  e: SystemEvent,
  filters: {
    severities?: EventSeverity[];
    types?: string[];
    moduleId?: string;
    q?: string;
    since?: string;
    until?: string;
  },
): boolean {
  const ts = Date.parse(e.timestamp);
  if (filters.since) {
    const sinceMs = Date.parse(filters.since);
    if (!Number.isNaN(sinceMs) && ts < sinceMs) return false;
  }
  if (filters.until) {
    const untilMs = Date.parse(filters.until);
    if (!Number.isNaN(untilMs) && ts > untilMs) return false;
  }
  const types = (filters.types ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (types.length && !types.some((needle) => e.type.toLowerCase().includes(needle))) return false;
  if (filters.moduleId && e.moduleId !== filters.moduleId) return false;
  const severities = filters.severities ?? [];
  if (severities.length && !severities.includes(eventSeverity(e.type))) return false;
  const q = filters.q?.trim().toLowerCase();
  if (q && !e.summary.toLowerCase().includes(q) && !e.type.toLowerCase().includes(q)) return false;
  return true;
}

export function appendEventsQueryParams(
  params: URLSearchParams,
  input: {
    severities?: EventSeverity[];
    types?: string[];
    moduleId?: string;
    q?: string;
  },
): void {
  for (const s of input.severities ?? []) {
    params.append("severity", s);
  }
  for (const t of input.types ?? []) {
    params.append("type", t);
  }
  if (input.moduleId?.trim()) params.set("moduleId", input.moduleId.trim());
  if (input.q?.trim()) params.set("q", input.q.trim());
}
