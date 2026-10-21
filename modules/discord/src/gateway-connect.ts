import { createHash } from "node:crypto";
import { Client, Events } from "discord.js";
import { formatDiscordLoginError } from "./login-errors.js";

const LOGIN_TIMEOUT_MS = 60_000;
const DESTROY_TIMEOUT_MS = 8_000;
const REST_CHECK_TIMEOUT_MS = 15_000;
/** Avoid hammering GET /users/@me on every reconnect (global rate limit is ~50 req/s shared). */
const TOKEN_VERIFY_CACHE_MS = 30 * 60 * 1000;

let cachedTokenFingerprint: string | null = null;
let cachedTokenVerifiedAt = 0;

export class DiscordRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, message: string) {
    super(message);
    this.name = "DiscordRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyBotToken(token: string, force = false): Promise<{ username: string }> {
  const fp = tokenFingerprint(token);
  const now = Date.now();
  if (!force && cachedTokenFingerprint === fp && now - cachedTokenVerifiedAt < TOKEN_VERIFY_CACHE_MS) {
    return { username: "(cached)" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
      signal: controller.signal,
    });
    if (res.status === 429) {
      const retryHeader = res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset-after");
      const retryAfterSec = Math.min(600, Math.max(5, parseInt(retryHeader ?? "60", 10) || 60));
      const body = await res.text();
      throw new DiscordRateLimitError(
        retryAfterSec,
        `Discord rate limit (429) on token check — wait ${retryAfterSec}s before retrying. ` +
          `This often happens after many rapid reconnects during development. ${body.slice(0, 120)}`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        "Discord rejected the bot token (401). In the Developer Portal → Bot → Reset Token, copy the new token into ECHO (no spaces).",
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord API token check failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { username?: string };
    cachedTokenFingerprint = fp;
    cachedTokenVerifiedAt = now;
    return { username: data.username ?? "bot" };
  } catch (err) {
    if (err instanceof DiscordRateLimitError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Could not reach Discord API (timeout). Check internet, firewall, or VPN blocking discord.com.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function destroyDiscordClient(client: Client): Promise<void> {
  client.removeAllListeners();
  await Promise.race([
    client.destroy(),
    new Promise<void>((resolve) => setTimeout(resolve, DESTROY_TIMEOUT_MS)),
  ]);
}

export async function loginDiscordClient(client: Client, token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Bot token is empty after trim.");
  }

  const { username } = await verifyBotToken(trimmed);
  if (username !== "(cached)") {
    console.log(`[discord] Token OK for @${username}, opening gateway WebSocket…`);
  } else {
    console.log("[discord] Token recently verified (skipped REST), opening gateway WebSocket…");
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Discord gateway did not become ready in ${LOGIN_TIMEOUT_MS / 1000}s. ` +
              "REST auth succeeded but the WebSocket may be blocked (firewall/VPN/proxy).",
          ),
        );
      }, LOGIN_TIMEOUT_MS);

      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onShardError = (err: Error, _shardId: number) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        client.off(Events.ClientReady, onReady);
        client.off(Events.Error, onError);
        client.off(Events.ShardError, onShardError);
      };

      client.once(Events.ClientReady, onReady);
      client.once(Events.Error, onError);
      client.on(Events.ShardError, onShardError);

      void client.login(trimmed).catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  } catch (err) {
    try {
      await destroyDiscordClient(client);
    } catch {
      /* ignore */
    }
    throw formatDiscordLoginError(err);
  }
}

/** Call when bot token changes so the next connect re-validates via REST. */
export function invalidateTokenVerifyCache(): void {
  cachedTokenFingerprint = null;
  cachedTokenVerifiedAt = 0;
}
