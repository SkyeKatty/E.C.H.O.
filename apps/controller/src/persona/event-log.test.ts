import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "./event-log.js";

describe("EventLog", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  function tempLog(maxPersisted = 100) {
    const dir = mkdtempSync(join(tmpdir(), "echo-events-"));
    dirs.push(dir);
    return new EventLog({ dataRoot: dir, maxPersisted });
  }

  it("paginates and filters by severity", () => {
    const log = tempLog();
    log.append({ type: "module.error", summary: "boom" });
    log.append({ type: "tool.start", summary: "ok" });
    log.append({ type: "cognition.warn", summary: "slow" });

    const errors = log.query({ severities: ["error"], pageSize: 10 });
    expect(errors.total).toBe(1);
    expect(errors.events[0]?.type).toBe("module.error");

    const warnAndError = log.query({ severities: ["error", "warn"], pageSize: 10 });
    expect(warnAndError.total).toBe(2);

    const page = log.query({ page: 1, pageSize: 2 });
    expect(page.events).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    const ts = page.events.map((e) => Date.parse(e.timestamp));
    expect(ts[0]).toBeLessThanOrEqual(ts[1] ?? ts[0]);
  });

  it("persists and reloads from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "echo-events-"));
    dirs.push(dir);
    const first = new EventLog({ dataRoot: dir, maxPersisted: 50 });
    first.append({ type: "test.event", summary: "hello" });

    const second = new EventLog({ dataRoot: dir, maxPersisted: 50 });
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0]?.summary).toBe("hello");
  });
});
