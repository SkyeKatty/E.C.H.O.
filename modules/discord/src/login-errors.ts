export function formatDiscordLoginError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/disallowed intents/i.test(raw)) {
    return new Error(
      'Discord rejected the bot connection: "Used disallowed intents". ' +
        'Open https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents. Turn ON "Message Content Intent" unless ECHO "Mentions only mode" is enabled. ' +
        'If you enabled "Server members intent" in ECHO settings, also turn ON "Server Members Intent" in the portal. Save Changes and restart the Discord module.',
    );
  }
  if (/gateway did not become ready|websocket may be blocked/i.test(raw)) {
    return err instanceof Error ? err : new Error(raw);
  }
  if (/token check failed|rejected the bot token|discord api unreachable/i.test(raw)) {
    return err instanceof Error ? err : new Error(raw);
  }
  if (/invalid token|token.*invalid/i.test(raw)) {
    return new Error("Discord rejected the bot token. Reset the token in the Developer Portal and paste the new token here.");
  }
  return err instanceof Error ? err : new Error(raw);
}
