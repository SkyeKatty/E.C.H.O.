import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemEvent } from "../types";
import {
  appendEventsQueryParams,
  eventMatchesFilters,
  eventSeverity,
  EVENT_SEVERITIES,
  presetToSince,
  type EventsQueryResult,
  type EventSeverity,
  type TimeRangePreset,
} from "../lib/events";

type Filters = {
  preset: TimeRangePreset;
  since: string;
  until: string;
  severities: EventSeverity[];
  types: string[];
  moduleId: string;
  q: string;
};

const DEFAULT_FILTERS: Filters = {
  preset: "24h",
  since: "",
  until: "",
  severities: [],
  types: [],
  moduleId: "",
  q: "",
};

function localInputToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function EventsPanel(props: {
  liveEvent: SystemEvent | null;
  moduleIds: string[];
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [knownTypes, setKnownTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [result, setResult] = useState<EventsQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/events/types");
        if (!res.ok) return;
        const data = (await res.json()) as { types: string[] };
        setKnownTypes(data.types ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const effectiveSince = useMemo(() => {
    if (filters.preset === "custom") return localInputToIso(filters.since);
    return presetToSince(filters.preset);
  }, [filters.preset, filters.since]);

  const effectiveUntil = useMemo(() => {
    if (filters.preset !== "custom") return undefined;
    return localInputToIso(filters.until);
  }, [filters.preset, filters.until]);

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        page,
        pageSize,
        effectiveSince,
        effectiveUntil,
        severities: filters.severities,
        types: filters.types,
        moduleId: filters.moduleId,
        q: filters.q,
      }),
    [
      page,
      pageSize,
      effectiveSince,
      effectiveUntil,
      filters.severities,
      filters.types,
      filters.moduleId,
      filters.q,
    ],
  );

  const fetchPage = useCallback(
    async (opts?: { pageOverride?: number; jumpToLatest?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const requestPage = opts?.pageOverride ?? page;
        params.set("page", String(requestPage));
        params.set("pageSize", String(pageSize));
        if (effectiveSince) params.set("since", effectiveSince);
        if (effectiveUntil) params.set("until", effectiveUntil);
        appendEventsQueryParams(params, filters);

        const res = await fetch(`/api/v1/events?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        let data = (await res.json()) as EventsQueryResult;

        if (opts?.jumpToLatest && data.totalPages > 1) {
          params.set("page", String(data.totalPages));
          const tailRes = await fetch(`/api/v1/events?${params.toString()}`);
          if (tailRes.ok) {
            data = (await tailRes.json()) as EventsQueryResult;
          }
        }

        setResult(data);
        setPage(data.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, effectiveSince, effectiveUntil, filters],
  );

  useEffect(() => {
    void fetchPage({ jumpToLatest: followLatest && page === 1 });
  }, [queryKey, fetchPage, followLatest, page]);

  useEffect(() => {
    if (followLatest && result && page === result.totalPages) {
      listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
    }
  }, [result, page, followLatest]);

  useEffect(() => {
    if (paused || !props.liveEvent || !result) return;
    const onLatestPage = page === result.totalPages;
    if (!onLatestPage) return;

    const match = eventMatchesFilters(props.liveEvent, {
      since: effectiveSince,
      until: effectiveUntil,
      severities: filters.severities,
      types: filters.types,
      moduleId: filters.moduleId,
      q: filters.q,
    });
    if (!match) return;

    setResult((prev) => {
      if (!prev) return prev;
      if (prev.events.some((e) => e.id === props.liveEvent!.id)) return prev;
      const events = [...prev.events, props.liveEvent!];
      const trimmed =
        events.length > prev.pageSize ? events.slice(events.length - prev.pageSize) : events;
      return {
        ...prev,
        events: trimmed,
        total: prev.total + 1,
        persistedCount: prev.persistedCount + 1,
      };
    });
  }, [props.liveEvent, paused, page, result, effectiveSince, effectiveUntil, filters]);

  function applyPreset(preset: TimeRangePreset) {
    setFollowLatest(true);
    setFilters((f) => ({ ...f, preset, since: "", until: "" }));
    setPage(1);
  }

  function resetFilters() {
    setFollowLatest(true);
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function selectSeverityPreset(preset: "all" | "issues") {
    setFollowLatest(true);
    setPage(1);
    if (preset === "all") {
      setFilters((f) => ({ ...f, severities: [] }));
    } else {
      setFilters((f) => ({ ...f, severities: ["error", "warn"] }));
    }
  }

  const rows = result?.events ?? [];
  const onLatestPage = result != null && page === result.totalPages;

  return (
    <div className="events-panel">
      <section className="card events-toolbar">
        <div className="events-toolbar-row">
          <label className="field-inline">
            <span className="muted">Range</span>
            <select
              value={filters.preset}
              onChange={(e) => applyPreset(e.target.value as TimeRangePreset)}
            >
              <option value="1h">Last hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="all">All stored</option>
              <option value="custom">Custom…</option>
            </select>
          </label>
          {filters.preset === "custom" && (
            <>
              <label className="field-inline">
                <span className="muted">From</span>
                <input
                  type="datetime-local"
                  value={filters.since}
                  onChange={(e) => {
                    setFollowLatest(true);
                    setFilters((f) => ({ ...f, since: e.target.value }));
                    setPage(1);
                  }}
                />
              </label>
              <label className="field-inline">
                <span className="muted">To</span>
                <input
                  type="datetime-local"
                  value={filters.until}
                  onChange={(e) => {
                    setFollowLatest(true);
                    setFilters((f) => ({ ...f, until: e.target.value }));
                    setPage(1);
                  }}
                />
              </label>
            </>
          )}
        </div>

        <div className="events-filter-group">
          <span className="muted events-filter-label">Severity</span>
          <div className="events-check-row">
            {EVENT_SEVERITIES.map((s) => (
              <label key={s} className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={filters.severities.includes(s)}
                  onChange={() => {
                    setFollowLatest(true);
                    setPage(1);
                    setFilters((f) => ({
                      ...f,
                      severities: toggleInList(f.severities, s),
                    }));
                  }}
                />
                {s}
              </label>
            ))}
            <button type="button" className="btn-link muted" onClick={() => selectSeverityPreset("all")}>
              Any
            </button>
            <button
              type="button"
              className="btn-link muted"
              onClick={() => selectSeverityPreset("issues")}
            >
              Warn + error
            </button>
          </div>
        </div>

        {knownTypes.length > 0 && (
          <div className="events-filter-group">
            <span className="muted events-filter-label">Event types</span>
            <div className="events-type-checks">
              {knownTypes.map((t) => (
                <label key={t} className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={filters.types.includes(t)}
                    onChange={() => {
                      setFollowLatest(true);
                      setPage(1);
                      setFilters((f) => ({
                        ...f,
                        types: toggleInList(f.types, t),
                      }));
                    }}
                  />
                  <span className="mono">{t}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="events-toolbar-row">
          <label className="field-inline grow">
            <span className="muted">Search</span>
            <input
              type="search"
              placeholder="Summary or type…"
              value={filters.q}
              onChange={(e) => {
                setFollowLatest(true);
                setFilters((f) => ({ ...f, q: e.target.value }));
                setPage(1);
              }}
            />
          </label>
          <label className="field-inline">
            <span className="muted">Module</span>
            <select
              value={filters.moduleId}
              onChange={(e) => {
                setFollowLatest(true);
                setFilters((f) => ({ ...f, moduleId: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">Any</option>
              {props.moduleIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="field-inline">
            <span className="muted">Page size</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setFollowLatest(true);
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button type="button" className="btn-secondary" onClick={() => void fetchPage()}>
            Refresh
          </button>
          <button type="button" className="btn-secondary" onClick={resetFilters}>
            Reset
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!result || onLatestPage}
            onClick={() => {
              setFollowLatest(true);
              if (result) setPage(result.totalPages);
              else setPage(1);
            }}
          >
            Latest
          </button>
          <label className="field-inline checkbox-inline">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />
            Pause live
          </label>
        </div>
        <p className="muted events-meta">
          {result != null && (
            <>
              Chronological (oldest → newest). Page {result.page} of {result.totalPages} ·{" "}
              {result.total} matching · {result.persistedCount} stored
            </>
          )}
          {loading && " · Loading…"}
          {followLatest && onLatestPage && !paused && " · Tailing latest"}
        </p>
      </section>

      {error && <div className="banner banner-warn">{error}</div>}

      <section className="card events-table-wrap">
        <ul ref={listRef} className="event-list events-table">
          {rows.map((e) => (
            <li key={e.id} className={`event-severity-${eventSeverity(e.type)}`}>
              <time className="mono" title={e.timestamp}>
                {new Date(e.timestamp).toLocaleString()}
              </time>
              <span className="event-type mono">{e.type}</span>
              {e.moduleId ? <span className="event-module mono">{e.moduleId}</span> : <span />}
              <span className="event-summary">{e.summary}</span>
            </li>
          ))}
          {!loading && rows.length === 0 && (
            <li className="muted events-empty">No events match these filters.</li>
          )}
        </ul>
      </section>

      {result && result.totalPages > 1 && (
        <nav className="events-pagination" aria-label="Events pagination">
          <button
            type="button"
            className="btn-secondary"
            disabled={page <= 1 || loading}
            onClick={() => {
              setFollowLatest(false);
              setPage((p) => Math.max(1, p - 1));
            }}
          >
            Older
          </button>
          <span className="mono muted">
            Page {result.page} / {result.totalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= result.totalPages || loading}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              if (result && next >= result.totalPages) setFollowLatest(true);
            }}
          >
            Newer
          </button>
        </nav>
      )}
    </div>
  );
}
