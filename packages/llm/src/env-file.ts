import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SECRETS_ALWAYS_FROM_FILE = new Set(["OPENROUTER_API_KEY", "ECHO_LOCAL_LLM_API_KEY"]);

/** Walk upward to find the monorepo root (pnpm-workspace.yaml). */
export function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/** Load KEY=VALUE lines from .env into process.env (does not override existing). */
export function loadEnvFiles(paths: string[]): string[] {
  const loaded: string[] = [];
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    let text = readFileSync(filePath, "utf8");
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      let key = trimmed.slice(0, eq).trim();
      if (key.charCodeAt(0) === 0xfeff) key = key.slice(1);
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const force = SECRETS_ALWAYS_FROM_FILE.has(key);
      if (force || !(key in process.env) || process.env[key] === "") {
        if (value.length > 0) {
          process.env[key] = value;
        }
      }
    }
    loaded.push(filePath);
  }
  return loaded;
}

export function defaultEnvFileCandidates(): string[] {
  const cwd = process.cwd();
  return [
    resolve(cwd, ".env"),
    resolve(cwd, "../.env"),
    resolve(cwd, "../../.env"),
    resolve(cwd, "../../../.env"),
  ];
}

/** Prefer monorepo-root .env (reliable when cwd varies under pnpm). */
export function loadProjectEnv(startDir: string): { root: string; loadedFiles: string[] } {
  const root = findMonorepoRoot(startDir);
  const candidates = [
    resolve(root, ".env"),
    resolve(root, ".env.local"),
    ...defaultEnvFileCandidates(),
  ];
  const seen = new Set<string>();
  const unique = candidates.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const loadedFiles = loadEnvFiles(unique);
  return { root, loadedFiles };
}

export function openRouterKeyStatus(): { configured: boolean; length: number } {
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  return { configured: key.length > 0, length: key.length };
}
