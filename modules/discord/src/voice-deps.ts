import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(fileURLToPath(import.meta.url));

let ready = false;

/**
 * Prime voice libraries before @discordjs/voice loads (0.19+ uses DAVE via @snazzah/davey).
 * ESM `import('libsodium-wrappers')` is unreliable under pnpm; @stablelib/xchacha20poly1305 is the fallback.
 */
export async function ensureVoiceCryptoDeps(): Promise<void> {
  if (ready) return;

  await import("@stablelib/xchacha20poly1305");

  try {
    const wrappers = require("libsodium-wrappers") as { ready: Promise<void> };
    await wrappers.ready;
  } catch (err) {
    console.warn(
      "[discord] libsodium-wrappers CJS preload failed (voice uses @stablelib/xchacha20poly1305):",
      err instanceof Error ? err.message : err,
    );
  }

  const voice = await import("@discordjs/voice");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  if (typeof voice.generateDependencyReport === "function") {
    const report = voice.generateDependencyReport();
    console.log("[discord] Voice dependency report:\n" + report);

    const hasEncryption =
      report.includes("@stablelib/xchacha20poly1305:") &&
      !report.includes("@stablelib/xchacha20poly1305: not found");
    const hasOpus =
      (report.includes("@discordjs/opus:") && !report.includes("@discordjs/opus: not found")) ||
      (report.includes("opusscript:") && !report.includes("opusscript: not found"));
    const hasDave =
      report.includes("@snazzah/davey:") && !report.includes("@snazzah/davey: not found");

    if (!hasEncryption || !hasOpus) {
      throw new Error(
        "Discord voice dependencies incomplete (encryption or opus). Run pnpm install from repo root.",
      );
    }
    if (!hasDave) {
      console.warn(
        "[discord] @snazzah/davey not found — Discord voice 0.19+ may fail on servers requiring DAVE. Run pnpm install.",
      );
    }
  }

  ready = true;
}
