/** Tracks humans speaking / STT capture so the bot does not start TTS over them. */

function channelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoiceOccupancy {
  private readonly speakingUsers = new Map<string, Set<string>>();
  private readonly sttCaptures = new Map<string, number>();

  userStarted(guildId: string, channelId: string, userId: string): void {
    const key = channelKey(guildId, channelId);
    let set = this.speakingUsers.get(key);
    if (!set) {
      set = new Set();
      this.speakingUsers.set(key, set);
    }
    set.add(userId);
  }

  userEnded(guildId: string, channelId: string, userId: string): void {
    const key = channelKey(guildId, channelId);
    const set = this.speakingUsers.get(key);
    if (!set) return;
    set.delete(userId);
    if (set.size === 0) this.speakingUsers.delete(key);
  }

  captureStarted(guildId: string, channelId: string): void {
    const key = channelKey(guildId, channelId);
    this.sttCaptures.set(key, (this.sttCaptures.get(key) ?? 0) + 1);
  }

  captureEnded(guildId: string, channelId: string): void {
    const key = channelKey(guildId, channelId);
    const next = (this.sttCaptures.get(key) ?? 1) - 1;
    if (next <= 0) this.sttCaptures.delete(key);
    else this.sttCaptures.set(key, next);
  }

  isOccupied(guildId: string, channelId: string): boolean {
    const key = channelKey(guildId, channelId);
    const speakers = this.speakingUsers.get(key);
    if (speakers && speakers.size > 0) return true;
    return (this.sttCaptures.get(key) ?? 0) > 0;
  }

  /**
   * Wait until no human speaking / STT capture, then hold for minSilentMs of continued quiet.
   * Returns false if maxWaitMs elapses while still occupied.
   */
  async waitUntilSilent(
    guildId: string,
    channelId: string,
    opts: { minSilentMs?: number; maxWaitMs?: number; pollMs?: number } = {},
  ): Promise<{ ok: boolean; timedOut?: boolean }> {
    const minSilentMs = opts.minSilentMs ?? 700;
    const maxWaitMs = opts.maxWaitMs ?? 120_000;
    const pollMs = opts.pollMs ?? 80;
    const deadline = Date.now() + maxWaitMs;
    let quietSince: number | null = null;

    while (Date.now() < deadline) {
      if (!this.isOccupied(guildId, channelId)) {
        if (quietSince === null) quietSince = Date.now();
        if (Date.now() - quietSince >= minSilentMs) return { ok: true };
      } else {
        quietSince = null;
      }
      await sleep(pollMs);
    }

    if (this.isOccupied(guildId, channelId)) {
      return { ok: false, timedOut: true };
    }
    return { ok: true };
  }
}
