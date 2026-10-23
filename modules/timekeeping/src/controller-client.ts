import { timeTimerFiredSchema } from "@echo/time-contract";

export class ControllerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
    return h;
  }

  async postTimerFired(payload: unknown): Promise<void> {
    const body = timeTimerFiredSchema.parse(payload);
    const res = await fetch(`${this.baseUrl}/api/v1/time/timer-fired`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`timer-fired failed: ${res.status} ${err}`);
    }
  }
}
