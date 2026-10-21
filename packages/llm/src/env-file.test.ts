import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFiles } from "./env-file.js";

describe("loadEnvFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "echo-env-"));
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("loads UTF-8 BOM .env", () => {
    const path = join(dir, "bom.env");
    writeFileSync(path, "\uFEFFOPENROUTER_API_KEY=secret-key-123\n", "utf8");
    loadEnvFiles([path]);
    expect(process.env.OPENROUTER_API_KEY).toBe("secret-key-123");
  });

  it("overrides empty OPENROUTER_API_KEY from file", () => {
    process.env.OPENROUTER_API_KEY = "";
    const path = join(dir, "override.env");
    writeFileSync(path, "OPENROUTER_API_KEY=from-file\n", "utf8");
    loadEnvFiles([path]);
    expect(process.env.OPENROUTER_API_KEY).toBe("from-file");
  });
});
