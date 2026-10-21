import type { WebSocket } from "ws";
import type { SystemSnapshot } from "../persona/state.js";

export class DashboardHub {
  private clients = new Set<WebSocket>();

  add(client: WebSocket): void {
    this.clients.add(client);
    client.on("close", () => this.clients.delete(client));
  }

  broadcast(snapshot: SystemSnapshot): void {
    const payload = JSON.stringify({ type: "system.snapshot", data: snapshot });
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  size(): number {
    return this.clients.size;
  }
}
