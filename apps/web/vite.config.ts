import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

function isAbortError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE";
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      // Fallback if anything still hits /ws via the dev server (dashboard uses direct WS in dev).
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", (err: Error, _req: IncomingMessage, res: Socket | NodeJS.WritableStream) => {
            if (isAbortError(err)) return;
            console.error("[vite] ws proxy error:", err);
          });
          proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
            socket.on("error", (err: Error) => {
              if (isAbortError(err)) return;
              console.error("[vite] ws proxy socket error:", err);
            });
          });
        },
      },
    },
  },
});
