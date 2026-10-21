import { useEffect, useState } from "react";
import type { SystemSnapshot } from "../types";

type ConnectionState = "connecting" | "connected" | "disconnected";

/** In dev, connect straight to the controller to avoid Vite ws-proxy ECONNABORTED noise. */
function dashboardWsUrl(): string {
  if (import.meta.env.DEV) {
    const base = import.meta.env.VITE_CONTROLLER_WS ?? "ws://127.0.0.1:8787";
    return `${base.replace(/\/+$/, "")}/ws/dashboard`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/dashboard`;
}

export function useDashboardSocket() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      ws = new WebSocket(dashboardWsUrl());

      ws.onopen = () => {
        if (disposed) return;
        setConnection("connected");
        setError(null);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(ev.data as string) as { type: string; data?: SystemSnapshot };
          if (msg.type === "system.snapshot" && msg.data) {
            setSnapshot(msg.data);
          }
        } catch {
          setError("Failed to parse dashboard update");
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnection("disconnected");
        retryTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        if (disposed) return;
        setError("Dashboard connection error");
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "dashboard unmount");
        }
      }
    };
  }, []);

  return { snapshot, connection, error };
}
