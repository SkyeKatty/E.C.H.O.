const STORAGE_PREFIX = "echo.chatSession.";

export function loadChatSessionId(characterId: string | null | undefined): string | undefined {
  if (!characterId || typeof localStorage === "undefined") return undefined;
  const raw = localStorage.getItem(STORAGE_PREFIX + characterId);
  if (!raw) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : undefined;
}

export function saveChatSessionId(characterId: string, sessionId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_PREFIX + characterId, sessionId);
}

export function ensureChatSessionId(characterId: string): string {
  const existing = loadChatSessionId(characterId);
  if (existing) return existing;
  const created = crypto.randomUUID();
  saveChatSessionId(characterId, created);
  return created;
}
