export function formatDiscordLoginError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/disallowed intents/i.test(raw)) {
    return new Error(
      'Discord rejected the bot connection: "Used disallowed intents". ' +
        'Open https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents and turn ON "Message Content Intent", then Save Changes and retry. ' +
        'If you cannot enable it, turn on "Mentions only mode" in ECHO Discord settings (the bot will only see @mentions, not normal channel messages).',
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
